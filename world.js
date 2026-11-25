/* ============================================================
   World renderer for 临“界”刹车
   - low-poly 3D highway chase scene
   - physical cockpit pedal viewport
   ============================================================ */
(function () {
  'use strict';

  const B = window.Brake3D;
  const V = B.vec;
  const clamp = B.clamp;
  const mix = B.mix;
  const smoothstep = B.smoothstep;
  const hex = B.hexToRgb;
  const CSS = B.rgbToCss;

  const COLORS = {
    skyTop: '#203436',
    skyMid: '#906656',
    skyHorizon: '#f0b77b',
    haze: '#e4b17c',
    sun: '#ffc266',
    sunLight: '#ffe0a3',
    mountainFar: '#49605a',
    mountainFarLight: '#587068',
    mountainMid: '#334b47',
    mountainMidLight: '#3e5750',
    mountainNear: '#203834',
    mountainNearLight: '#29443e',
    groundFar: '#6d5f4b',
    groundNear: '#262822',
    asphalt: '#1c2320',
    asphaltLight: '#28302b',
    line: '#d9c7a8',
    shoulder: '#8a7255',
    carBody: '#d96142',
    carBodyLight: '#eb7a55',
    carRoof: '#1d2620',
    carGlass: '#142322',
    carDark: '#18201c',
    carSilver: '#9a9a8a',
    tire: '#0d1110',
    rim: '#cfc5ae',
    tail: '#ff5138',
    tagGreen: '#85c9a7',
    lampMetal: '#303a34',
    lampDark: '#111713',
    hazard: '#e8b144',
    cone: '#e3653f',
    sign: '#e8dcc4',
    signDark: '#243029',
    pole: '#354139',
  };

  const view = {
    mainCanvas: null,
    pedalCanvas: null,
    ctx: null,
    pedalCtx: null,
    width: 0,
    height: 0,
    dpr: 1,
    pedalSize: 0,
    pedalDpr: 1,
    staticFaces: [],
    signLabels: [],
    lampZ: -500,
    carLaneX: 2.2,
    carLength: 4.5,
    lastPhase: 'intro',
    particles: [],
    lastCrashOutcome: null,
    exploded: false,
    worldTime: 0,
    lastState: null,
    reducedMotion: false,
  };

  const seeded = (() => {
    let state = 0x8f3a21;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
  })();

  /* ----------------------------------------------------------
     Viewport setup
     ---------------------------------------------------------- */

  function resizeMain() {
    if (!view.mainCanvas) return;
    const rect = view.mainCanvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = dpr;
    view.mainCanvas.width = Math.round(view.width * dpr);
    view.mainCanvas.height = Math.round(view.height * dpr);
    view.ctx = view.mainCanvas.getContext('2d');
    view.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resizePedal() {
    if (!view.pedalCanvas) return;
    const rect = view.pedalCanvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.pedalSize = Math.max(1, Math.min(rect.width, rect.height));
    view.pedalDpr = dpr;
    view.pedalCanvas.width = Math.round(view.pedalSize * dpr);
    view.pedalCanvas.height = Math.round(view.pedalSize * dpr);
    view.pedalCtx = view.pedalCanvas.getContext('2d');
    view.pedalCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    resizeMain();
    resizePedal();
  }

  /* ----------------------------------------------------------
     Static scene construction
     ---------------------------------------------------------- */

  function makeRock(faces, x, z, size) {
    const h = size * (0.55 + seeded() * 0.8);
    const w = size * (0.7 + seeded() * 1.2);
    const y = 0;
    B.addPyramid(faces, {
      x, y, z, w, h, d: w * (0.7 + seeded() * 0.7),
      color: seeded() > 0.5 ? '#4c4f43' : '#3b443d',
      fog: true,
      rot: { y: seeded() * Math.PI },
    });
  }

  function makeMesa(faces, x, z, w, h) {
    B.addBox(faces, {
      x, y: 0, z, w, h: h * 0.55, d: w * 0.72,
      color: '#3d4b44',
      fog: true,
      edge: false,
      rot: { y: seeded() * 0.4 },
    });
    B.addBox(faces, {
      x: x + w * 0.06, y: h * 0.55, z: z - w * 0.02, w: w * 0.7, h: h * 0.45, d: w * 0.55,
      color: '#4e5b50',
      fog: true,
      edge: false,
      rot: { y: seeded() * 0.4 },
    });
  }

  function makeSign(faces, x, z, label) {
    const postX = x;
    B.addBox(faces, {
      x: postX, y: 0, z, w: 0.12, h: 2.25, d: 0.12,
      color: COLORS.pole, fog: true, edge: false,
    });
    B.addBox(faces, {
      x: postX, y: 1.95, z, w: 1.25, h: 0.7, d: 0.12,
      color: COLORS.sign, fog: true, edge: '#5d5444', edgeWidth: 0.8,
    });
    B.addBox(faces, {
      x: postX, y: 2.7, z, w: 1.35, h: 0.04, d: 0.14,
      color: COLORS.signDark, fog: true, edge: false,
    });
    view.signLabels.push({
      x: postX,
      y: 2.3,
      z: z + 0.08,
      text: String(label),
      sub: 'M',
      color: '#26322b',
      size: 0.52,
    });
  }

  function makeLamp(faces) {
    const x = view.carLaneX;
    const z = view.lampZ;
    // concrete foot with hazard bands
    B.addBox(faces, {
      x, y: 0, z, w: 0.8, h: 0.38, d: 0.8,
      color: '#343e37', edge: '#111713', edgeWidth: 0.9,
    });
    for (let i = 0; i < 3; i += 1) {
      B.addBox(faces, {
        x, y: 0.02 + i * 0.13, z: z - 0.41, w: 0.82, h: 0.07, d: 0.025,
        color: i % 2 === 0 ? COLORS.hazard : '#171d19',
        edge: false,
        emissive: i === 0,
        fog: true,
      });
    }
    // pole
    B.addBox(faces, {
      x, y: 0.36, z, w: 0.18, h: 6.3, d: 0.18,
      color: COLORS.lampMetal, edge: '#0c1210', edgeWidth: 1,
    });
    B.addBox(faces, {
      x, y: 0.36, z: z + 0.1, w: 0.06, h: 6.3, d: 0.06,
      color: '#4b5750', edge: false,
    });
    // arm reaching over the lane
    B.addBox(faces, {
      x: x - 0.7, y: 6.48, z, w: 1.45, h: 0.13, d: 0.14,
      color: COLORS.lampMetal, edge: '#0c1210', edgeWidth: 0.8,
    });
    B.addBox(faces, {
      x: x - 1.38, y: 6.13, z, w: 0.5, h: 0.22, d: 0.34,
      color: '#1a211d', edge: '#080c09', edgeWidth: 0.9,
    });
    // glowing lens under the head
    B.addPlane(faces, {
      points: [
        V(-1.51, 6.12, -0.12),
        V(-1.25, 6.12, -0.12),
        V(-1.25, 6.12, 0.12),
        V(-1.51, 6.12, 0.12),
      ],
      origin: V(x, 0, z),
      color: COLORS.sunLight,
      emissive: true,
      fog: false,
      edge: false,
    });
    // hazard plate on pole
    B.addPlane(faces, {
      points: [
        V(-0.21, 2.8, 0.14),
        V(0, 3.01, 0.14),
        V(0.21, 2.8, 0.14),
        V(0, 2.59, 0.14),
      ],
      origin: V(x, 0, z),
      color: COLORS.hazard,
      edge: '#281d0c',
      edgeWidth: 1,
      fog: false,
    });
    B.addPlane(faces, {
      points: [
        V(-0.12, 2.8, 0.155),
        V(0, 2.92, 0.155),
        V(0.12, 2.8, 0.155),
        V(0, 2.68, 0.155),
      ],
      origin: V(x, 0, z),
      color: '#18140b',
      edge: false,
      fog: false,
    });
    // amber beacon at the top
    B.addBox(faces, {
      x: x + 0.02, y: 6.67, z, w: 0.16, h: 0.16, d: 0.16,
      color: '#ffc04c', emissive: true, fog: false, edge: false,
    });
    // cones
    for (let i = 0; i < 3; i += 1) {
      const cx = x + (i - 1) * 0.52;
      const cz = z + 0.7;
      B.addPyramid(faces, {
        x: cx, y: 0, z: cz, w: 0.22, h: 0.55, d: 0.22,
        color: COLORS.cone, edge: '#2b160c', edgeWidth: 0.8, fog: false,
      });
      B.addBox(faces, {
        x: cx, y: 0.14, z: cz + 0.01, w: 0.19, h: 0.08, d: 0.19,
        color: '#f1e1bd', edge: false, fog: false,
      });
    }
    // hazard crossbar in front of the cone line
    for (let i = 0; i < 4; i += 1) {
      B.addBox(faces, {
        x: x + 0.75 + i * 0.18, y: 0.12, z: z + 0.72, w: 0.18, h: 0.11, d: 0.16,
        color: i % 2 === 0 ? COLORS.hazard : '#1b1a12',
        edge: false,
        fog: false,
      });
    }
    view.lampGlow = {
      x: x - 1.38, y: 6.08, z: z,
      color: hex('#ffdc91'),
      radius: 1.2,
      strength: 0.9,
      minPx: 5,
      maxPx: 26,
    };
    view.lampBeaconGlow = {
      x, y: 6.8, z,
      color: hex('#ffb347'),
      radius: 0.7,
      strength: 1.1,
      minPx: 3.5,
      maxPx: 18,
    };
  }

  function buildStaticWorld() {
    view.staticFaces = [];
    view.signLabels = [];
    const faces = view.staticFaces;

    // Far ground volumes & silhouettes
    for (let i = 0; i < 26; i += 1) {
      const side = seeded() > 0.5 ? -1 : 1;
      const z = -30 - seeded() * 720;
      const x = side * (11 + seeded() * 48);
      const size = 1 + seeded() * 4.5;
      if (side > 0 && Math.abs(x) < 18) continue;
      makeRock(faces, x, z, size);
    }

    // Low mesas on both sides, farther out.
    const mesas = [
      [-38, -160, 22, 9],
      [45, -230, 26, 13],
      [-52, -330, 36, 16],
      [62, -430, 42, 20],
      [-76, -550, 55, 26],
      [78, -640, 60, 28],
    ];
    mesas.forEach(([x, z, w, h]) => makeMesa(faces, x, z, w, h));

    // Roadside reflectors, spaced 18 m apart. They help convey speed in 3D.
    for (let z = -8; z > -540; z -= 18) {
      for (let side = -1; side <= 1; side += 2) {
        const x = side * 6.25;
        B.addBox(faces, {
          x, y: 0, z, w: 0.11, h: 0.7, d: 0.11,
          color: '#39433c', fog: true, edge: false,
        });
        B.addBox(faces, {
          x, y: 0.63, z, w: 0.16, h: 0.12, d: 0.16,
          color: '#eab45e', fog: true, edge: false, emissive: true,
        });
      }
    }

    // Distance pylons.
    makeSign(faces, -7.8, -100, 100);
    makeSign(faces, -7.8, -200, 200);
    makeSign(faces, -7.8, -300, 300);
    makeSign(faces, -7.8, -400, 400);

    // A few utility pylons for parallax.
    for (let i = 0; i < 4; i += 1) {
      const z = -110 - i * 150;
      const x = i % 2 === 0 ? 17 : -19;
      B.addBox(faces, {
        x, y: 0, z, w: 0.16, h: 5.2, d: 0.16,
        color: '#29342e', fog: true, edge: false,
      });
      B.addBox(faces, {
        x, y: 4.8, z, w: 2.1, h: 0.09, d: 0.09,
        color: '#29342e', fog: true, edge: false,
      });
      B.addBox(faces, {
        x, y: 4.2, z, w: 1.4, h: 0.07, d: 0.07,
        color: '#29342e', fog: true, edge: false,
      });
    }

    // Some low desert brush near the shoulder.
    for (let z = -24; z > -450; z -= 32) {
      const x = (seeded() > 0.5 ? 1 : -1) * (7.8 + seeded() * 5);
      const s = 0.5 + seeded() * 1.1;
      B.addBox(faces, {
        x, y: 0, z, w: s, h: s * 0.5, d: s * 0.62,
        color: seeded() > 0.5 ? '#515943' : '#5d5b43',
        fog: true,
        edge: false,
        rot: { y: seeded() * Math.PI },
      });
    }

    makeLamp(faces);
  }

  /* ----------------------------------------------------------
     Car
     ---------------------------------------------------------- */

  function addWheelSpokes(faces, center, side, radius, wheelAngle, rimColor = COLORS.rim) {
    // Plane at x = side * (outer face), ring + 3 spokes.
    const xOuter = center.x + side * 0.145;
    const ring = [];
    const segments = 10;
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      ring.push(V(xOuter, center.y + Math.cos(a) * radius, center.z + Math.sin(a) * radius));
    }
    B.addPolygon(faces, ring, COLORS.tire, { edge: '#060806', edgeWidth: 0.8 });
    const rim = [];
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      rim.push(V(
        xOuter + side * 0.002,
        center.y + Math.cos(a) * radius * 0.54,
        center.z + Math.sin(a) * radius * 0.54,
      ));
    }
    B.addPolygon(faces, rim, rimColor, { edge: false });
    // spokes — these rotate with the wheel
    for (let k = 0; k < 3; k += 1) {
      const a0 = wheelAngle + (k / 3) * Math.PI * 2;
      const points = [];
      const innerR = radius * 0.12;
      const outerR = radius * 0.46;
      for (let q = 0; q < 4; q += 1) {
        const a = a0 + (q % 2 === 0 ? -0.13 : 0.13);
        const rr = q < 2 ? innerR : outerR;
        points.push(V(xOuter + side * 0.003, center.y + Math.cos(a) * rr, center.z + Math.sin(a) * rr));
      }
      B.addPolygon(faces, points, '#3b4b42', { edge: false });
    }
    B.addBox(faces, {
      x: xOuter + side * 0.01,
      y: center.y - 0.035,
      z: center.z - 0.035,
      w: 0.06,
      h: 0.07,
      d: 0.07,
      color: '#171d18',
      edge: false,
    });
  }

  function buildSuvFaces(state) {
    const faces = [];
    const glows = [];
    const travel = state.travel || 0;
    const carZ = 2.25 - travel;
    const carX = view.carLaneX;
    const bodyY = 0.26;
    const dive = state.phase === 'running' ? (state.force / 1400) * 0.02 : 0;
    const bounce = state.phase === 'running'
      ? Math.sin((state.time || 0) * 15) * Math.min(0.012, (state.v / 33) * 0.012)
      : 0;
    const crashTilt = state.phase === 'crash'
      ? (state.outcome === 'lucky' ? 0.014 : -0.03)
      : 0;
    const rot = { x: -dive + crashTilt, y: 0, z: 0 };
    const origin = V(carX, bodyY + bounce, carZ);
    const bodyColor = state.outcome === 'burn' && (state.exploded || state.phase === 'ended')
      ? '#292d28'
      : state.outcome === 'lucky' && (state.phase === 'crash' || state.phase === 'ended')
        ? '#a94731'
        : COLORS.carBody;
    const roofColor = state.outcome === 'burn' && (state.exploded || state.phase === 'ended')
      ? '#36362e'
      : COLORS.carRoof;
    const glassColor = state.outcome === 'burn' && (state.exploded || state.phase === 'ended')
      ? '#101310'
      : COLORS.carGlass;
    const trimColor = state.outcome === 'burn' && (state.exploded || state.phase === 'ended')
      ? '#414139'
      : COLORS.carDark;
    const edge = '#121813';

    const p = (lx, ly, lz) => {
      const r = B.rotatePoint(V(lx, ly, lz), rot);
      return V(r.x + origin.x, r.y + origin.y, r.z + origin.z);
    };

    // Lower body — a deep box with a slightly narrower upper body.
    B.addBox(faces, {
      x: origin.x, y: origin.y, z: origin.z,
      w: 1.84, h: 0.5, d: 4.2,
      color: bodyColor, edge, edgeWidth: 1.1, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.02, z: origin.z,
      w: 1.78, h: 0.22, d: 3.9,
      color: COLORS.carDark, edge, edgeWidth: 0.7, rot,
    });

    // Rocker panels / side sill
    B.addBox(faces, {
      x: origin.x - 0.87, y: origin.y + 0.02, z: origin.z,
      w: 0.08, h: 0.18, d: 3.15,
      color: trimColor, edge: false, rot,
    });
    B.addBox(faces, {
      x: origin.x + 0.87, y: origin.y + 0.02, z: origin.z,
      w: 0.08, h: 0.18, d: 3.15,
      color: trimColor, edge: false, rot,
    });
    // Warm cream character line and door seams.
    B.addBox(faces, {
      x: origin.x - 0.926, y: origin.y + 0.36, z: origin.z + 0.1,
      w: 0.012, h: 0.035, d: 2.65,
      color: '#f0dfc3', edge: false, fog: false, rot,
    });
    B.addBox(faces, {
      x: origin.x + 0.926, y: origin.y + 0.36, z: origin.z + 0.1,
      w: 0.012, h: 0.035, d: 2.65,
      color: '#f0dfc3', edge: false, fog: false, rot,
    });
    B.addBox(faces, {
      x: origin.x + 0.935, y: origin.y + 0.28, z: origin.z + 0.3,
      w: 0.012, h: 0.22, d: 0.018,
      color: '#26312a', edge: false, rot,
    });
    B.addBox(faces, {
      x: origin.x + 0.935, y: origin.y + 0.28, z: origin.z - 0.9,
      w: 0.012, h: 0.22, d: 0.018,
      color: '#26312a', edge: false, rot,
    });

    // Cabin: custom tapered volume.
    // local points on top/bottom around the body origin.
    const cabPoints = {
      br: p(-0.82, 0.46, 1.64),
      bl: p(0.82, 0.46, 1.64),
      fr: p(-0.82, 0.46, -1.42),
      fl: p(0.82, 0.46, -1.42),
      tr: p(-0.7, 1.36, 1.25),
      tl: p(0.7, 1.36, 1.25),
      trf: p(-0.7, 1.36, -0.88),
      tlf: p(0.7, 1.36, -0.88),
    };
    // side surfaces
    B.addPolygon(faces, [cabPoints.fr, cabPoints.br, cabPoints.tr, cabPoints.trf], bodyColor, { edge, edgeWidth: 1 });
    B.addPolygon(faces, [cabPoints.bl, cabPoints.fl, cabPoints.tlf, cabPoints.tl], bodyColor, { edge, edgeWidth: 1 });
    // rear slope
    B.addPolygon(faces, [cabPoints.br, cabPoints.bl, cabPoints.tl, cabPoints.tr], bodyColor, { edge, edgeWidth: 1 });
    // roof
    B.addPolygon(faces, [cabPoints.tr, cabPoints.tl, cabPoints.tlf, cabPoints.trf], roofColor, { edge, edgeWidth: 1 });
    // front slope (barely visible)
    B.addPolygon(faces, [cabPoints.fl, cabPoints.fr, cabPoints.trf, cabPoints.tlf], bodyColor, { edge, edgeWidth: 1 });

    // Rear glass, slightly proud of the rear face.
    B.addPolygon(faces, [
      p(-0.64, 0.58, 1.69),
      p(0.64, 0.58, 1.69),
      p(0.58, 1.28, 1.3),
      p(-0.58, 1.28, 1.3),
    ], glassColor, { edge: '#08100d', edgeWidth: 1.2 });
    // Side glass bands (visible on the camera side).
    B.addPolygon(faces, [
      p(0.825, 0.6, 1.21),
      p(0.825, 0.6, -0.58),
      p(0.708, 1.28, -0.58),
      p(0.708, 1.28, 1.03),
    ], glassColor, { edge: '#08100d', edgeWidth: 1 });
    B.addPolygon(faces, [
      p(-0.825, 0.6, 1.21),
      p(-0.825, 0.6, -0.58),
      p(-0.708, 1.28, -0.58),
      p(-0.708, 1.28, 1.03),
    ], glassColor, { edge: false });
    // B-pillars
    B.addBox(faces, {
      x: origin.x + 0.73, y: origin.y + 0.52, z: origin.z + 0.18,
      w: 0.06, h: 0.72, d: 0.12,
      color: bodyColor, edge: false, rot,
    });
    B.addBox(faces, {
      x: origin.x - 0.73, y: origin.y + 0.52, z: origin.z + 0.18,
      w: 0.06, h: 0.72, d: 0.12,
      color: bodyColor, edge: false, rot,
    });

    // Roof rails.
    B.addBox(faces, {
      x: origin.x - 0.63, y: origin.y + 1.35, z: origin.z + 0.08,
      w: 0.06, h: 0.08, d: 1.95,
      color: '#d9c9ae', edge: '#3a342b', edgeWidth: 0.6, rot,
    });
    B.addBox(faces, {
      x: origin.x + 0.63, y: origin.y + 1.35, z: origin.z + 0.08,
      w: 0.06, h: 0.08, d: 1.95,
      color: '#d9c9ae', edge: '#3a342b', edgeWidth: 0.6, rot,
    });
    // Twin cream motorsport stripes across the dark roof.
    B.addBox(faces, {
      x: origin.x - 0.17, y: origin.y + 1.37, z: origin.z + 0.12,
      w: 0.11, h: 0.012, d: 1.86,
      color: '#d8c9ad', edge: false, fog: false, rot,
    });
    B.addBox(faces, {
      x: origin.x + 0.17, y: origin.y + 1.37, z: origin.z + 0.12,
      w: 0.11, h: 0.012, d: 1.86,
      color: '#d8c9ad', edge: false, fog: false, rot,
    });
    // spoiler
    B.addBox(faces, {
      x: origin.x, y: origin.y + 1.25, z: origin.z + 1.45,
      w: 1.32, h: 0.07, d: 0.26,
      color: roofColor, edge: '#1b201b', rot,
    });

    // rear tailgate details
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.42, z: origin.z + 2.08,
      w: 1.63, h: 0.055, d: 0.04,
      color: '#211e19', edge: false, rot,
    });
    // rear light bar pieces, set into dark recesses
    const lightOn = state.phase === 'running' && state.force > 16;
    const tailColor = lightOn ? '#e73420' : '#75251d';
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.67, z: origin.z + 2.14,
      w: 1.58, h: 0.2, d: 0.04,
      color: '#090c09', edge: false, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.73, z: origin.z + 2.18,
      w: 1.44, h: 0.075, d: 0.04,
      color: tailColor, emissive: lightOn, edge: lightOn ? '#ff8d74' : '#2b1712', edgeWidth: 0.4, fog: false, rot,
    });
    for (const side of [-1, 1]) {
      B.addBox(faces, {
        x: origin.x + side * 0.68, y: origin.y + 0.715, z: origin.z + 2.15,
        w: 0.25, h: 0.35, d: 0.04,
        color: '#090c09', edge: false, rot,
      });
      B.addBox(faces, {
        x: origin.x + side * 0.68, y: origin.y + 0.78, z: origin.z + 2.19,
        w: 0.14, h: 0.25, d: 0.04,
        color: tailColor, emissive: lightOn, edge: lightOn ? '#ff8d74' : '#2b1712', edgeWidth: 0.4, fog: false, rot,
      });
    }
    // rear bumper and skid plate
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.02, z: origin.z + 2.15,
      w: 1.88, h: 0.28, d: 0.18,
      color: COLORS.carDark, edge: '#111713', edgeWidth: 0.8, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.02, z: origin.z + 2.23,
      w: 0.9, h: 0.12, d: 0.04,
      color: COLORS.carSilver, edge: false, rot,
    });
    // plate
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.37, z: origin.z + 2.23,
      w: 0.56, h: 0.17, d: 0.035,
      color: '#e8e2cf', edge: '#5a594c', edgeWidth: 0.6, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.39, z: origin.z + 2.255,
      w: 0.46, h: 0.055, d: 0.01,
      color: '#30352d', edge: false, rot,
    });
    // small EV marker
    B.addBox(faces, {
      x: origin.x + 0.64, y: origin.y + 0.38, z: origin.z + 2.235,
      w: 0.2, h: 0.075, d: 0.02,
      color: COLORS.tagGreen, edge: false, emissive: true, fog: false, rot,
    });
    // rear wiper
    B.addBox(faces, {
      x: origin.x + 0.08, y: origin.y + 0.73, z: origin.z + 1.72,
      w: 0.44, h: 0.022, d: 0.025,
      color: '#151c17', edge: false, rot,
    });
    // side mirrors (right side mostly visible)
    B.addBox(faces, {
      x: origin.x - 0.92, y: origin.y + 0.86, z: origin.z - 0.73,
      w: 0.13, h: 0.1, d: 0.2,
      color: bodyColor, edge: '#151c17', edgeWidth: 0.7, rot,
    });
    B.addBox(faces, {
      x: origin.x + 0.92, y: origin.y + 0.86, z: origin.z - 0.73,
      w: 0.13, h: 0.1, d: 0.2,
      color: bodyColor, edge: '#151c17', edgeWidth: 0.7, rot,
    });

    // wheels
    const wheelZ = 1.35;
    const wheelY = 0.38;
    for (let side = -1; side <= 1; side += 2) {
      const wx = carX + side * 0.87;
      B.addCylinderX(faces, {
        x: wx, y: wheelY, z: carZ + wheelZ,
        radius: 0.4, width: 0.28, sides: 12,
        color: COLORS.tire, capColor: '#070a08',
        edge: '#050706', edgeWidth: 0.7,
        tag: 'wheel',
      });
      B.addCylinderX(faces, {
        x: wx, y: wheelY, z: carZ - wheelZ,
        radius: 0.4, width: 0.28, sides: 12,
        color: COLORS.tire, capColor: '#070a08',
        edge: '#050706', edgeWidth: 0.7,
        tag: 'wheel',
      });
      addWheelSpokes(faces, V(wx, wheelY, carZ + wheelZ), side, 0.4, state.wheelAngle || 0);
      addWheelSpokes(faces, V(wx, wheelY, carZ - wheelZ), side, 0.4, state.wheelAngle || 0);
    }

    // dark fender flares / side steps
    for (let side = -1; side <= 1; side += 2) {
      for (let end = -1; end <= 1; end += 2) {
        B.addBox(faces, {
          x: carX + side * 0.935, y: 0.28, z: carZ + end * 1.35,
          w: 0.035, h: 0.22, d: 1.02,
          color: '#1a211c', edge: '#070a07', edgeWidth: 0.6,
        });
      }
      B.addBox(faces, {
        x: carX + side * 0.95, y: 0.06, z: carZ + 0.08,
        w: 0.1, h: 0.08, d: 2.1,
        color: '#171d18', edge: false,
      });
    }

    // Tail light glows.
    if (lightOn) {
      glows.push({
        x: carX, y: bodyY + bounce + 0.79, z: carZ + 2.22,
        color: hex('#ff3a20'), radius: 0.8, strength: 0.8,
        minPx: 8, maxPx: 72,
      });
      glows.push({
        x: carX - 0.68, y: bodyY + bounce + 0.86, z: carZ + 2.23,
        color: hex('#ff3a20'), radius: 0.45, strength: 0.62,
        minPx: 5, maxPx: 38,
      });
      glows.push({
        x: carX + 0.68, y: bodyY + bounce + 0.86, z: carZ + 2.23,
        color: hex('#ff3a20'), radius: 0.45, strength: 0.62,
        minPx: 5, maxPx: 38,
      });
    }
    // Regen accent glow near the rear axle.
    if (state.regen > 30 && state.phase === 'running') {
      glows.push({
        x: carX + 0.92, y: 0.18, z: carZ + 1.34,
        color: hex('#7ed6bd'), radius: 0.5, strength: 0.5,
        minPx: 2, maxPx: 22,
      });
      glows.push({
        x: carX - 0.92, y: 0.18, z: carZ + 1.34,
        color: hex('#7ed6bd'), radius: 0.5, strength: 0.5,
        minPx: 2, maxPx: 22,
      });
    }

    return { faces, glows, carZ, carX };
  }

  function buildMpvFaces(state) {
    const faces = [];
    const glows = [];
    const travel = state.travel || 0;
    const carZ = 2.25 - travel;
    const carX = view.carLaneX;
    const bodyY = 0.26;
    const dive = state.phase === 'running' ? (state.force / 1400) * 0.017 : 0;
    const bounce = state.phase === 'running'
      ? Math.sin((state.time || 0) * 14) * Math.min(0.01, (state.v / 33) * 0.01)
      : 0;
    const crashTilt = state.phase === 'crash'
      ? (state.outcome === 'lucky' ? 0.012 : -0.026)
      : 0;
    const rot = { x: -dive + crashTilt, y: 0, z: 0 };
    const origin = V(carX, bodyY + bounce, carZ);
    const burnt = state.outcome === 'burn' && (state.exploded || state.phase === 'ended');
    const damaged = state.outcome === 'lucky' && (state.phase === 'crash' || state.phase === 'ended');
    const bodyColor = burnt ? '#2c312c' : damaged ? '#9b8974' : '#d5cdbc';
    const bodyLight = burnt ? '#353a33' : damaged ? '#b09b83' : '#e6ddca';
    const roofColor = burnt ? '#3b3e36' : damaged ? '#5b5142' : '#1e2521';
    const chromeColor = burnt ? '#605d50' : damaged ? '#8d826f' : '#b9b2a1';
    const glassColor = burnt ? '#101410' : '#0c1816';
    const trimColor = burnt ? '#3b4039' : '#19231f';
    const edge = '#0c110e';
    const lightOn = state.phase === 'running' && state.force > 16;
    const tailColor = lightOn ? '#f13a23' : '#74251d';

    // Lower body and dark rocker/underbody.
    B.addBox(faces, {
      x: origin.x, y: origin.y, z: origin.z,
      w: 1.94, h: 0.42, d: 4.55,
      color: bodyColor, edge, edgeWidth: 1.1, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.015, z: origin.z,
      w: 1.88, h: 0.16, d: 4.5,
      color: trimColor, edge: false, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.37, z: origin.z,
      w: 1.9, h: 0.36, d: 4.3,
      color: bodyColor, edge, edgeWidth: 1, rot,
    });

    // Tall one-box cabin.
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.72, z: origin.z - 0.02,
      w: 1.82, h: 0.66, d: 3.95,
      color: bodyColor, edge, edgeWidth: 1, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.4, z: origin.z + 2.08,
      w: 1.84, h: 1.0, d: 0.1,
      color: bodyColor, edge, edgeWidth: 0.9, rot,
    });

    // Roof and panoramic glass.
    B.addBox(faces, {
      x: origin.x, y: origin.y + 1.38, z: origin.z - 0.02,
      w: 1.78, h: 0.07, d: 3.9,
      color: roofColor, edge: '#2c2b22', edgeWidth: 0.8, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 1.472, z: origin.z - 0.08,
      w: 1.18, h: 0.016, d: 1.82,
      color: glassColor, edge: chromeColor, edgeWidth: 0.8, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 1.466, z: origin.z - 0.08,
      w: 1.26, h: 0.012, d: 1.9,
      color: chromeColor, edge: false, fog: false, rot,
    });
    for (const side of [-1, 1]) {
      B.addBox(faces, {
        x: origin.x + side * 0.83, y: origin.y + 1.382, z: origin.z - 0.02,
        w: 0.045, h: 0.025, d: 3.62,
        color: chromeColor, edge: false, rot,
      });
    }
    // Chrome beltline and lower garnish.
    for (const side of [-1, 1]) {
      B.addBox(faces, {
        x: origin.x + side * 0.958, y: origin.y + 0.72, z: origin.z + 0.02,
        w: 0.016, h: 0.028, d: 3.95,
        color: chromeColor, edge: false, rot,
      });
      B.addBox(faces, {
        x: origin.x + side * 0.965, y: origin.y + 0.07, z: origin.z + 0.02,
        w: 0.018, h: 0.035, d: 3.85,
        color: chromeColor, edge: false, rot,
      });
    }

    // Side glass, chrome window surrounds and pillars.
    for (const side of [-1, 1]) {
      const sx = origin.x + side * 0.916;
      B.addBox(faces, {
        x: sx, y: origin.y + 0.93, z: origin.z + 0.9,
        w: 0.012, h: 0.39, d: 1.48,
        color: glassColor, edge: '#07100e', edgeWidth: 0.8, rot,
      });
      B.addBox(faces, {
        x: sx, y: origin.y + 0.93, z: origin.z - 0.92,
        w: 0.012, h: 0.39, d: 1.18,
        color: glassColor, edge: '#07100e', edgeWidth: 0.8, rot,
      });
      // upper and lower chrome window lines
      B.addBox(faces, {
        x: origin.x + side * 0.923, y: origin.y + 0.9, z: origin.z + 0.02,
        w: 0.012, h: 0.018, d: 3.44,
        color: chromeColor, edge: false, fog: false, rot,
      });
      B.addBox(faces, {
        x: origin.x + side * 0.923, y: origin.y + 1.31, z: origin.z + 0.02,
        w: 0.012, h: 0.022, d: 3.44,
        color: chromeColor, edge: false, fog: false, rot,
      });
      // black/chrome B pillar
      B.addBox(faces, {
        x: origin.x + side * 0.925, y: origin.y + 0.91, z: origin.z - 0.06,
        w: 0.018, h: 0.43, d: 0.1,
        color: trimColor, edge: chromeColor, edgeWidth: 0.4, rot,
      });
      // D pillar
      B.addBox(faces, {
        x: origin.x + side * 0.925, y: origin.y + 0.9, z: origin.z + 1.72,
        w: 0.018, h: 0.44, d: 0.12,
        color: trimColor, edge: false, rot,
      });
      // sliding door seam / handle / mirror
      B.addBox(faces, {
        x: origin.x + side * 0.972, y: origin.y + 0.16, z: origin.z + 0.43,
        w: 0.008, h: 0.68, d: 0.014,
        color: '#101713', edge: false, rot,
      });
      B.addBox(faces, {
        x: origin.x + side * 0.974, y: origin.y + 0.62, z: origin.z + 0.14,
        w: 0.014, h: 0.032, d: 0.16,
        color: chromeColor, edge: false, fog: false, rot,
      });
      B.addBox(faces, {
        x: origin.x + side * 1.0, y: origin.y + 0.88, z: origin.z - 0.92,
        w: 0.13, h: 0.09, d: 0.18,
        color: bodyLight, edge: edge, edgeWidth: 0.6, rot,
      });
    }

    // Rear hatch glass, chrome surround and spoiler.
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.91, z: origin.z + 2.15,
      w: 1.5, h: 0.44, d: 0.018,
      color: glassColor, edge: chromeColor, edgeWidth: 0.8, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.86, z: origin.z + 2.17,
      w: 1.55, h: 0.035, d: 0.018,
      color: chromeColor, edge: false, fog: false, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 1.36, z: origin.z + 1.99,
      w: 1.64, h: 0.055, d: 0.28,
      color: roofColor, edge: '#28261f', edgeWidth: 0.6, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 1.36, z: origin.z + 2.13,
      w: 1.55, h: 0.026, d: 0.035,
      color: chromeColor, edge: false, fog: false, rot,
    });

    // Full-width LED tail bar and corner lamps.
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.61, z: origin.z + 2.15,
      w: 1.76, h: 0.24, d: 0.045,
      color: '#090d0a', edge: false, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.69, z: origin.z + 2.19,
      w: 1.56, h: 0.052, d: 0.025,
      color: tailColor, emissive: lightOn, edge: lightOn ? '#ff9b82' : '#2b1712', edgeWidth: 0.4, fog: false, rot,
    });
    for (const side of [-1, 1]) {
      B.addBox(faces, {
        x: origin.x + side * 0.75, y: origin.y + 0.63, z: origin.z + 2.16,
        w: 0.25, h: 0.36, d: 0.05,
        color: '#090d0a', edge: chromeColor, edgeWidth: 0.35, rot,
      });
      B.addBox(faces, {
        x: origin.x + side * 0.75, y: origin.y + 0.67, z: origin.z + 2.2,
        w: 0.13, h: 0.27, d: 0.025,
        color: tailColor, emissive: lightOn, edge: lightOn ? '#ff9b82' : '#2b1712', edgeWidth: 0.4, fog: false, rot,
      });
    }

    // Rear bumper, chrome garnish, plate and EV badge.
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.01, z: origin.z + 2.24,
      w: 1.96, h: 0.23, d: 0.2,
      color: trimColor, edge: edge, edgeWidth: 0.8, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.08, z: origin.z + 2.34,
      w: 1.5, h: 0.035, d: 0.02,
      color: chromeColor, edge: false, fog: false, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.24, z: origin.z + 2.345,
      w: 0.58, h: 0.15, d: 0.02,
      color: '#e9e3d1', edge: '#514f43', edgeWidth: 0.5, rot,
    });
    B.addBox(faces, {
      x: origin.x, y: origin.y + 0.275, z: origin.z + 2.36,
      w: 0.46, h: 0.055, d: 0.008,
      color: '#2e352e', edge: false, rot,
    });
    B.addBox(faces, {
      x: origin.x + 0.67, y: origin.y + 0.39, z: origin.z + 2.17,
      w: 0.2, h: 0.06, d: 0.018,
      color: '#83c7a5', edge: false, emissive: true, fog: false, rot,
    });
    B.addBox(faces, {
      x: origin.x - 0.53, y: origin.y + 0.42, z: origin.z + 2.17,
      w: 0.34, h: 0.035, d: 0.014,
      color: chromeColor, edge: false, fog: false, rot,
    });
    // rear wiper
    B.addBox(faces, {
      x: origin.x + 0.1, y: origin.y + 1.3, z: origin.z + 2.17,
      w: 0.48, h: 0.018, d: 0.02,
      color: '#131b17', edge: false, rot,
    });

    // Wheels with polished rims and subtle chrome arch trims.
    const wheelZ = 1.48;
    const wheelY = 0.38;
    const wheelR = 0.4;
    for (const side of [-1, 1]) {
      const wx = carX + side * 0.88;
      for (const end of [-1, 1]) {
        B.addCylinderX(faces, {
          x: wx, y: wheelY, z: carZ + end * wheelZ,
          radius: wheelR, width: 0.28, sides: 12,
          color: COLORS.tire, capColor: '#070a08',
          edge: '#050706', edgeWidth: 0.7, tag: 'wheel',
        });
        addWheelSpokes(faces, V(wx, wheelY, carZ + end * wheelZ), side, wheelR, state.wheelAngle || 0, '#d8d1be');
        B.addBox(faces, {
          x: carX + side * 0.96, y: 0.29, z: carZ + end * wheelZ,
          w: 0.018, h: 0.06, d: 0.85,
          color: chromeColor, edge: false, rot,
        });
      }
      B.addBox(faces, {
        x: carX + side * 0.97, y: 0.055, z: carZ + 0.08,
        w: 0.02, h: 0.045, d: 2.4,
        color: trimColor, edge: false, rot,
      });
    }

    // Brake and regen glows.
    if (lightOn) {
      glows.push({
        x: carX, y: bodyY + bounce + 0.72, z: carZ + 2.24,
        color: hex('#ff3820'), radius: 0.78, strength: 0.78,
        minPx: 8, maxPx: 72,
      });
      glows.push({
        x: carX - 0.75, y: bodyY + bounce + 0.8, z: carZ + 2.25,
        color: hex('#ff3820'), radius: 0.44, strength: 0.58,
        minPx: 5, maxPx: 38,
      });
      glows.push({
        x: carX + 0.75, y: bodyY + bounce + 0.8, z: carZ + 2.25,
        color: hex('#ff3820'), radius: 0.44, strength: 0.58,
        minPx: 5, maxPx: 38,
      });
    }
    if (state.regen > 30 && state.phase === 'running') {
      glows.push({
        x: carX + 0.96, y: 0.18, z: carZ + 1.48,
        color: hex('#7ed6bd'), radius: 0.45, strength: 0.42,
        minPx: 2, maxPx: 20,
      });
      glows.push({
        x: carX - 0.96, y: 0.18, z: carZ + 1.48,
        color: hex('#7ed6bd'), radius: 0.45, strength: 0.42,
        minPx: 2, maxPx: 20,
      });
    }

    return { faces, glows, carZ, carX };
  }

  function buildCarFaces(state) {
    return state.vehicle === 'mpv' ? buildMpvFaces(state) : buildSuvFaces(state);
  }

  /* ----------------------------------------------------------
     Backdrop and road
     ---------------------------------------------------------- */

  function ridgeProfile(width, offset, amplitude, seedOffset, step = 60) {
    const points = [];
    let x = -width * 0.2;
    let i = 0;
    while (x < width * 1.2) {
      const n = seededLike(seedOffset + i);
      const n2 = seededLike(seedOffset + i * 2.37 + 11);
      const h = amplitude * (0.4 + n * 0.6) + (n2 > 0.82 ? amplitude * 0.8 : 0);
      points.push({ x, h });
      x += step * (0.72 + n * 0.75);
      i += 1;
    }
    return points;
  }

  function seededLike(n) {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  function drawSky(ctx, cam, state) {
    const w = view.width;
    const h = view.height;
    const horizon = B.horizonY(cam);
    const skyBottom = clamp(horizon, h * 0.24, h * 0.62);

    const sky = ctx.createLinearGradient(0, 0, 0, skyBottom);
    sky.addColorStop(0, COLORS.skyTop);
    sky.addColorStop(0.52, COLORS.skyMid);
    sky.addColorStop(0.82, '#d18b61');
    sky.addColorStop(1, COLORS.skyHorizon);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, skyBottom + 2);

    // Sun: a faceted low-poly disc just above the horizon.
    const sunX = w * 0.64 - (state.travel || 0) * 0.002;
    const sunY = skyBottom - h * 0.115;
    const sunRadius = Math.min(w, h) * 0.085;
    ctx.save();
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunRadius * 2.7);
    sunGlow.addColorStop(0, 'rgba(255, 205, 126, 0.18)');
    sunGlow.addColorStop(0.5, 'rgba(255, 177, 95, 0.07)');
    sunGlow.addColorStop(1, 'rgba(255, 177, 95, 0)');
    ctx.fillStyle = sunGlow;
    ctx.fillRect(sunX - sunRadius * 3, sunY - sunRadius * 3, sunRadius * 6, sunRadius * 6);
    const segments = 10;
    for (let i = 0; i < segments; i += 1) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(sunX, sunY);
      ctx.lineTo(sunX + Math.cos(a0) * sunRadius, sunY + Math.sin(a0) * sunRadius);
      ctx.lineTo(sunX + Math.cos(a1) * sunRadius, sunY + Math.sin(a1) * sunRadius);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? COLORS.sun : '#ffa94f';
      ctx.globalAlpha = 0.9;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // A couple of horizontal glitter cuts for the retro-sunset feel.
    ctx.fillStyle = 'rgba(239, 176, 119, 0.85)';
    ctx.fillRect(sunX - sunRadius, sunY + sunRadius * 0.1, sunRadius * 2, sunRadius * 0.085);
    ctx.fillRect(sunX - sunRadius * 0.76, sunY + sunRadius * 0.38, sunRadius * 1.52, sunRadius * 0.07);
    ctx.restore();

    // Low-poly clouds.
    const cloudOffset = (state.travel || 0) * 0.01;
    drawCloud(ctx, w * 0.18 - cloudOffset, skyBottom - h * 0.34, w * 0.18, h * 0.032, 0.22);
    drawCloud(ctx, w * 0.73 - cloudOffset * 0.6, skyBottom - h * 0.27, w * 0.12, h * 0.024, 0.16);
    drawCloud(ctx, w * 0.43 - cloudOffset * 0.3, skyBottom - h * 0.44, w * 0.085, h * 0.018, 0.12);

    // Distant ridge line with facets.
    const ridgeBase = skyBottom + 2;
    drawRidge(ctx, w, ridgeBase, horizon, state.travel || 0, {
      far: true,
    });
    ctx.fillStyle = 'rgba(230, 174, 119, 0.16)';
    ctx.fillRect(0, skyBottom - 1, w, 2);
  }

  function drawCloud(ctx, x, y, w, h, opacity) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = '#282d2b';
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w * 0.18, y + h * 0.28);
    ctx.lineTo(x + w * 0.52, y + h * 0.28);
    ctx.lineTo(x + w * 0.61, y);
    ctx.lineTo(x + w * 0.93, y + h * 0.1);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(238, 168, 112, 0.22)';
    ctx.fillRect(x + w * 0.21, y + h * 0.28, w * 0.65, 1);
    ctx.restore();
  }

  function drawRidge(ctx, w, base, horizon, travel, options = {}) {
    const far = options.far;
    const parallax = travel * (far ? 0.008 : 0.035);
    const offset = -(parallax % (w * 0.35));
    const layers = [
      {
        color: COLORS.mountainFar,
        light: COLORS.mountainFarLight,
        amplitude: Math.min(92, view.height * 0.145),
        step: 78,
        seed: 2.7,
        y: base,
      },
      {
        color: COLORS.mountainMid,
        light: COLORS.mountainMidLight,
        amplitude: Math.min(62, view.height * 0.095),
        step: 55,
        seed: 8.2,
        y: base - 3,
      },
    ];

    for (let layer = 0; layer < layers.length; layer += 1) {
      const l = layers[layer];
      const points = ridgeProfile(w, offset, l.amplitude, l.seed + layer * 8, l.step);
      ctx.save();
      ctx.translate(offset + (layer === 0 ? 0 : w * 0.12), 0);
      // filled faceted silhouette
      for (let i = 0; i < points.length - 1; i += 1) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const top0 = l.y - p0.h;
        const top1 = l.y - p1.h;
        const peakX = p0.x + (p1.x - p0.x) * 0.5;
        const peakY = l.y - Math.max(p0.h, p1.h) - 4;
        ctx.beginPath();
        ctx.moveTo(p0.x, l.y + 12);
        ctx.lineTo(p0.x, top0);
        ctx.lineTo(peakX, peakY);
        ctx.lineTo(p1.x, top1);
        ctx.lineTo(p1.x, l.y + 12);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? l.color : l.light;
        ctx.fill();
      }
      ctx.restore();
    }

    // foreground ridge, darker
    const points = ridgeProfile(w, offset * 1.1, Math.min(35, view.height * 0.055), 4.1, 42);
    ctx.save();
    ctx.translate(offset * 1.1 + w * 0.05, 0);
    ctx.fillStyle = COLORS.mountainNear;
    ctx.beginPath();
    ctx.moveTo(-w * 0.2, base + 20);
    points.forEach((p) => {
      ctx.lineTo(p.x, base - p.h);
    });
    ctx.lineTo(w * 1.2, base + 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(237, 154, 94, 0.15)';
    for (let i = 0; i < points.length - 1; i += 1) {
      if (i % 3 === 0) {
        ctx.beginPath();
        ctx.moveTo(points[i].x, base - points[i].h);
        ctx.lineTo(points[i + 1].x, base - points[i + 1].h);
        ctx.lineTo(points[i + 1].x, base + 12);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawGround(ctx, cam) {
    const w = view.width;
    const h = view.height;
    const horizon = B.horizonY(cam);
    const g = ctx.createLinearGradient(0, horizon, 0, h);
    g.addColorStop(0, '#b88961');
    g.addColorStop(0.12, '#756048');
    g.addColorStop(0.44, '#393a2f');
    g.addColorStop(1, '#141a16');
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.max(0, horizon - 1), w, h - Math.max(0, horizon - 1) + 1);

    // Haze band at the horizon.
    const haze = ctx.createLinearGradient(0, horizon - 22, 0, horizon + 40);
    haze.addColorStop(0, 'rgba(238, 177, 121, 0)');
    haze.addColorStop(0.48, 'rgba(238, 177, 121, 0.18)');
    haze.addColorStop(1, 'rgba(238, 177, 121, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - 22, w, 62);
  }

  function projectedGroundPoint(cam, x, y, z) {
    return B.project(cam, V(x, y, z));
  }

  function drawRoad(ctx, cam, travel) {
    const w = view.width;
    const h = view.height;
    const horizon = B.horizonY(cam);
    const zNear = cam.position.z - 1.8;
    const zFar = cam.position.z - 760;
    const half = 5.4;

    const nearLeft = projectedGroundPoint(cam, -half, 0, zNear);
    const nearRight = projectedGroundPoint(cam, half, 0, zNear);
    const farLeft = projectedGroundPoint(cam, -half, 0, zFar);
    const farRight = projectedGroundPoint(cam, half, 0, zFar);
    if (!nearLeft || !nearRight || !farLeft || !farRight) return;

    // shoulders
    for (let side = -1; side <= 1; side += 2) {
      const aNear = projectedGroundPoint(cam, side * half, 0.002, zNear);
      const bNear = projectedGroundPoint(cam, side * (half + 2.2), 0.002, zNear);
      const aFar = projectedGroundPoint(cam, side * half, 0.002, zFar);
      const bFar = projectedGroundPoint(cam, side * (half + 2.2), 0.002, zFar);
      if (!aNear || !bNear || !aFar || !bFar) continue;
      ctx.beginPath();
      ctx.moveTo(aNear.x, aNear.y);
      ctx.lineTo(bNear.x, bNear.y);
      ctx.lineTo(bFar.x, bFar.y);
      ctx.lineTo(aFar.x, aFar.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(104, 85, 61, 0.72)';
      ctx.fill();
    }

    // asphalt
    const roadGradient = ctx.createLinearGradient(0, horizon, 0, h);
    roadGradient.addColorStop(0, '#3c3b33');
    roadGradient.addColorStop(0.16, '#252b27');
    roadGradient.addColorStop(0.6, '#191f1c');
    roadGradient.addColorStop(1, '#121715');
    ctx.beginPath();
    ctx.moveTo(nearLeft.x, nearLeft.y);
    ctx.lineTo(farLeft.x, farLeft.y);
    ctx.lineTo(farRight.x, farRight.y);
    ctx.lineTo(nearRight.x, nearRight.y);
    ctx.closePath();
    ctx.fillStyle = roadGradient;
    ctx.fill();

    // edge lines
    for (let side = -1; side <= 1; side += 2) {
      const x = side * 5.12;
      const a = projectedGroundPoint(cam, x - 0.055, 0.012, zNear);
      const b = projectedGroundPoint(cam, x + 0.055, 0.012, zNear);
      const c = projectedGroundPoint(cam, x + 0.055, 0.012, zFar);
      const d = projectedGroundPoint(cam, x - 0.055, 0.012, zFar);
      if (!a || !b || !c || !d) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      const edgeGradient = ctx.createLinearGradient(0, horizon, 0, h);
      edgeGradient.addColorStop(0, 'rgba(208, 188, 156, 0.1)');
      edgeGradient.addColorStop(0.35, 'rgba(220, 203, 172, 0.56)');
      edgeGradient.addColorStop(1, 'rgba(234, 218, 186, 0.8)');
      ctx.fillStyle = edgeGradient;
      ctx.fill();
    }

    // dashed centerline, spaced in world metres.
    const startZ = Math.floor((cam.position.z - 4) / 12) * 12;
    for (let z = startZ; z > cam.position.z - 620; z -= 12) {
      const z0 = z;
      const z1 = z - 6;
      const a = projectedGroundPoint(cam, -0.075, 0.014, z0);
      const b = projectedGroundPoint(cam, 0.075, 0.014, z0);
      const c = projectedGroundPoint(cam, 0.075, 0.014, z1);
      const d = projectedGroundPoint(cam, -0.075, 0.014, z1);
      if (!a || !b || !c || !d) continue;
      const depth = (a.depth + d.depth) * 0.5;
      if (depth < cam.near + 0.2) continue;
      const fog = smoothstep(40, 560, depth);
      const alpha = (0.74 - fog * 0.68) * clamp(depth / 28, 0, 1);
      if (alpha <= 0.015) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fillStyle = `rgba(221, 205, 176, ${alpha})`;
      ctx.fill();
    }

    // Tar seams / tire darkening in the foreground.
    const tireShade = ctx.createLinearGradient(0, h * 0.6, 0, h);
    tireShade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    tireShade.addColorStop(1, 'rgba(0, 0, 0, 0.34)');
    ctx.fillStyle = tireShade;
    ctx.fillRect(0, h * 0.6, w, h * 0.4);
  }

  function drawCarShadow(ctx, cam, state) {
    const carZ = 2.25 - (state.travel || 0);
    const x = view.carLaneX;
    const y = 0.015;
    const front = carZ - 2.1;
    const rear = carZ + 2.4;
    const points = [
      projectedGroundPoint(cam, x - 1.12, y, front),
      projectedGroundPoint(cam, x + 1.12, y, front),
      projectedGroundPoint(cam, x + 1.28, y, rear + 0.8),
      projectedGroundPoint(cam, x - 1.28, y, rear + 0.8),
    ];
    if (points.some((p) => !p)) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    const g = ctx.createLinearGradient(points[0].x, points[0].y, points[2].x, points[2].y);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.46)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.08)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  function drawLampShadow(ctx, cam) {
    const x = view.carLaneX;
    const z = view.lampZ;
    const pts = [
      projectedGroundPoint(cam, x - 0.6, 0.01, z + 0.45),
      projectedGroundPoint(cam, x + 0.6, 0.01, z + 0.45),
      projectedGroundPoint(cam, x + 0.5, 0.01, z + 2.4),
      projectedGroundPoint(cam, x - 0.5, 0.01, z + 2.4),
    ];
    if (pts.some((p) => !p)) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fill();
    ctx.restore();
  }

  function drawSignLabels(ctx, cam) {
    for (let i = 0; i < view.signLabels.length; i += 1) {
      const sign = view.signLabels[i];
      const p = B.project(cam, V(sign.x, sign.y, sign.z));
      if (!p || p.depth > 230 || p.x < -60 || p.x > view.width + 60) continue;
      const s = (sign.size / p.depth) * cam.focal;
      if (s < 3) continue;
      const alpha = clamp(1 - smoothstep(150, 250, p.depth), 0, 1) * 0.8;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = sign.color;
      ctx.font = `600 ${Math.max(4, s)}px "Bahnschrift", "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sign.text, p.x, p.y);
      ctx.font = `500 ${Math.max(3, s * 0.42)}px "Bahnschrift", sans-serif`;
      ctx.fillText(sign.sub, p.x, p.y + s * 0.58);
      ctx.restore();
    }
  }

  /* ----------------------------------------------------------
     Camera + effects
     ---------------------------------------------------------- */

  function cameraForState(state) {
    const travel = state.travel || 0;
    const carZ = 2.25 - travel;
    const shake = state.shake || 0;
    const time = state.time || 0;
    const sway = Math.sin(time * 1.1) * 0.045;
    const shakeX = shake ? Math.sin(time * 71) * shake * 0.025 : 0;
    const shakeY = shake ? Math.cos(time * 61) * shake * 0.018 : 0;
    const introDrift = state.phase === 'intro'
      ? Math.sin(time * 0.45) * 0.7
      : 0;
    const isMpv = state.vehicle === 'mpv';
    const sideOffset = isMpv ? 2.6 : 2.35;
    const backOffset = isMpv ? 10.4 : 9.15;
    const targetOffset = isMpv ? -1.8 : -1.45;
    const position = V(
      view.carLaneX + sideOffset + sway + shakeX + introDrift,
      (isMpv ? 3.65 : 3.5) + shakeY,
      carZ + backOffset,
    );
    const target = V(
      view.carLaneX + targetOffset + introDrift * 0.4,
      0.92,
      carZ - 28,
    );
    const cam = B.makeCamera(position, target, 52, view.width, view.height);
    // Lens shift: lifts the car out of the cockpit lip without pointing
    // the whole camera down at the floor.
    cam.cy = view.height * (isMpv ? 0.455 : 0.46);
    return cam;
  }

  function drawTargetMarker(ctx, cam, state) {
    if (state.phase === 'crash' || state.phase === 'ended') return;
    const p = B.project(cam, V(view.carLaneX, 6.85, view.lampZ));
    if (!p) return;
    const fade = clamp((p.depth - 10) / 18, 0, 1);
    if (fade <= 0.02) return;
    const size = clamp(cam.focal * 0.013, 8, 15);
    ctx.save();
    ctx.globalAlpha = 0.32 * fade;
    ctx.strokeStyle = '#ffc167';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + size * 0.5);
    ctx.lineTo(p.x, p.y + size * 3.8);
    ctx.stroke();

    ctx.globalAlpha = 0.8 * fade;
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 2.8);
    glow.addColorStop(0, 'rgba(255, 199, 105, 0.32)');
    glow.addColorStop(1, 'rgba(255, 199, 105, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 196, 105, 0.86)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - size);
    ctx.lineTo(p.x + size, p.y);
    ctx.lineTo(p.x, p.y + size);
    ctx.lineTo(p.x - size, p.y);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 201, 108, 0.7)';
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);

    ctx.globalAlpha = 0.52 * fade;
    ctx.fillStyle = 'rgba(255, 213, 150, 0.78)';
    ctx.font = `500 ${Math.max(5, Math.min(8, size * 0.55))}px "Bahnschrift", "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('LAMP', p.x, p.y - size * 1.7);
    ctx.restore();
  }

  function drawGlows(ctx, cam, glows) {
    if (!glows || !glows.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < glows.length; i += 1) {
      const g = glows[i];
      B.drawGlow(ctx, cam, V(g.x, g.y, g.z), g.radius, g.color, g.strength, {
        minPx: g.minPx,
        maxPx: g.maxPx,
      });
    }
    ctx.restore();
  }

  function drawLampBeacon(ctx, cam, state) {
    if (!view.lampGlow) return;
    const p = B.project(cam, V(view.lampZ * 0 + view.carLaneX, 2, view.lampZ));
    if (!p) return;
    // A subtle diamond waypoint above the lamp, useful at 500 m.
    if (p.depth > 420) {
      const glow = B.project(cam, V(view.carLaneX, 7.35, view.lampZ));
      if (glow) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ffbd62';
        ctx.beginPath();
        ctx.moveTo(glow.x, glow.y - 4);
        ctx.lineTo(glow.x + 3, glow.y);
        ctx.lineTo(glow.x, glow.y + 4);
        ctx.lineTo(glow.x - 3, glow.y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  /* ----------------------------------------------------------
     Pedal viewport
     ---------------------------------------------------------- */

  function buildPedalScene(depress, snapped, held) {
    const faces = [];
    const d = clamp(depress || 0, 0, 1);

    // Footwell shell. Lighter surfaces keep the small viewport readable.
    B.addBox(faces, {
      x: 0, y: -0.1, z: 0.16, w: 1.18, h: 0.1, d: 1.5,
      color: '#20261f', edge: '#090d09', edgeWidth: 0.8,
    });
    // floor mat with ribs
    B.addBox(faces, {
      x: 0, y: 0.0, z: 0.08, w: 0.92, h: 0.018, d: 1.1,
      color: '#2a3229', edge: false,
    });
    for (let i = 0; i < 5; i += 1) {
      B.addBox(faces, {
        x: 0, y: 0.021, z: 0.46 - i * 0.2, w: 0.72, h: 0.008, d: 0.014,
        color: '#394136', edge: false,
      });
    }
    B.addBox(faces, {
      x: -0.57, y: 0, z: 0.12, w: 0.08, h: 1.02, d: 1.42,
      color: '#252d25', edge: false,
    });
    B.addBox(faces, {
      x: 0.57, y: 0, z: 0.12, w: 0.08, h: 1.02, d: 1.42,
      color: '#252d25', edge: false,
    });
    B.addBox(faces, {
      x: 0, y: 0, z: -0.62, w: 1.14, h: 0.9, d: 0.08,
      color: '#242b23', edge: '#080b08', edgeWidth: 0.7,
    });
    B.addBox(faces, {
      x: 0, y: 0.84, z: -0.12, w: 1.08, h: 0.16, d: 0.64,
      color: '#1b221b', edge: '#080b08', edgeWidth: 0.6,
    });
    // under-dash warm light bar
    B.addBox(faces, {
      x: 0, y: 0.79, z: -0.39, w: 0.66, h: 0.028, d: 0.05,
      color: '#ffe0a0', emissive: true, edge: false, fog: false,
    });
    B.addBox(faces, {
      x: 0, y: 0.78, z: -0.47, w: 0.8, h: 0.05, d: 0.04,
      color: '#3d3a2b', edge: false, fog: false,
    });

    // Footwell LED strip on the firewall.
    B.addBox(faces, {
      x: -0.38, y: 0.61, z: -0.615, w: 0.04, h: 0.035, d: 0.02,
      color: snapped ? '#ff5a43' : '#ffbc68', emissive: true, edge: false, fog: false,
    });

    // Brake pedal arm and pad. The pad is deliberately oversized and legible.
    const pedalAngle = -0.5 - d * 0.16;
    const padY = 0.28 - d * 0.018;
    const padZ = -0.13 - d * 0.08;
    // arm from firewall toward the pad
    B.addBox(faces, {
      x: 0.015, y: 0.14, z: -0.45,
      w: 0.075, h: 0.64, d: 0.075,
      color: '#7f8374', edge: '#11150f', edgeWidth: 0.8,
      rot: { x: -0.24 - d * 0.09 },
    });
    B.addBox(faces, {
      x: 0.015, y: 0.52, z: -0.48,
      w: 0.12, h: 0.1, d: 0.11,
      color: '#292f28', edge: false,
    });
    // metal backing plate
    B.addBox(faces, {
      x: 0.01, y: padY - 0.035, z: padZ - 0.035,
      w: 0.39, h: 0.5, d: 0.06,
      color: '#ada790', edge: '#25281f', edgeWidth: 0.8,
      rot: { x: pedalAngle },
    });
    // rubber pedal face
    B.addBox(faces, {
      x: 0.01, y: padY, z: padZ,
      w: 0.345, h: 0.46, d: 0.06,
      color: '#252c25', edge: '#090c09', edgeWidth: 0.95,
      rot: { x: pedalAngle },
    });
    // orange reference ribs on the pedal
    for (let i = 0; i < 4; i += 1) {
      B.addBox(faces, {
        x: 0.01, y: padY + 0.075 + i * 0.09, z: padZ + 0.048,
        w: 0.27, h: 0.024, d: 0.02,
        color: i === 0 ? '#f4aa59' : '#b9b6a1',
        edge: false,
        rot: { x: pedalAngle },
      });
    }
    // wide heel bar at the base of the pad
    B.addBox(faces, {
      x: 0.01, y: padY + 0.015, z: padZ + 0.052,
      w: 0.29, h: 0.03, d: 0.02,
      color: '#f1a24e', edge: false, fog: false,
      rot: { x: pedalAngle },
    });
    // top warning LED on the pedal plate
    B.addBox(faces, {
      x: 0.01, y: padY + 0.43, z: padZ + 0.062,
      w: 0.09, h: 0.03, d: 0.018,
      color: snapped ? '#ff4d3a' : (held ? '#ffb068' : '#8a402b'),
      emissive: snapped || held,
      edge: false,
      fog: false,
      rot: { x: pedalAngle },
    });

    // Accelerator to the right for spatial context.
    B.addBox(faces, {
      x: 0.35, y: 0.05, z: -0.31,
      w: 0.15, h: 0.58, d: 0.05,
      color: '#20261e', edge: '#080b08', edgeWidth: 0.7,
      rot: { x: -0.55 },
    });
    for (let i = 0; i < 3; i += 1) {
      B.addBox(faces, {
        x: 0.35, y: 0.14 + i * 0.15, z: -0.285 + i * 0.02,
        w: 0.11, h: 0.014, d: 0.012,
        color: '#5f5f4f', edge: false,
        rot: { x: -0.55 },
      });
    }
    // Driver's left footrest.
    B.addBox(faces, {
      x: -0.37, y: 0.025, z: 0.06,
      w: 0.23, h: 0.05, d: 0.4,
      color: '#262e25', edge: '#090c09', edgeWidth: 0.6,
      rot: { x: -0.16, z: 0.05 },
    });

    // A low shoe toe just entering the viewport at the bottom edge keeps
    // the viewpoint human without hiding the brake pedal.
    B.addBox(faces, {
      x: 0.11, y: 0.07, z: 0.42,
      w: 0.2, h: 0.12, d: 0.22,
      color: '#4c4938', edge: '#0c0e0a', edgeWidth: 0.8,
      rot: { x: -0.12, y: -0.1 },
    });
    B.addBox(faces, {
      x: 0.11, y: 0.055, z: 0.42,
      w: 0.22, h: 0.035, d: 0.24,
      color: '#c5a873', edge: '#423422', edgeWidth: 0.6,
      rot: { x: -0.12, y: -0.1 },
    });

    return faces;
  }

  function renderPedal(state) {
    if (!view.pedalCtx || !view.pedalSize) return;
    const ctx = view.pedalCtx;
    const size = view.pedalSize;
    ctx.clearRect(0, 0, size, size);

    const bg = ctx.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, '#172016');
    bg.addColorStop(0.55, '#0c120c');
    bg.addColorStop(1, '#060905');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    const depress = state.pedalDepress || 0;
    const faces = buildPedalScene(depress, state.snapped, state.held);
    const cam = B.makeCamera(
      V(0.42, 1.0, 1.0),
      V(0.01, 0.35, -0.12),
      55,
      size,
      size,
    );
    cam.cy = size * 0.52;

    B.renderFaces(ctx, cam, faces, {
      light: B.normalize(V(-0.3, 0.9, 0.36)),
      fogColor: hex('#0b100b'),
      fogNear: 24,
      fogFar: 46,
      ambient: 0.68,
      diffuse: 0.56,
      edgeAlpha: 0.66,
      outline: true,
    });

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    B.drawGlow(ctx, cam, V(0, 0.79, -0.39), 0.34, hex('#ffd89a'), 1, {
      minPx: 2, maxPx: size * 0.36,
    });
    B.drawGlow(ctx, cam, V(0.08, 0.24, 0.08), 0.34, hex('#d9b57e'), 0.14, {
      minPx: 1, maxPx: size * 0.3,
    });
    B.drawGlow(ctx, cam, V(0, 0.36, -0.04), 0.28, hex('#ffbc74'), 0.2, {
      minPx: 1, maxPx: size * 0.24,
    });
    if (state.held) {
      B.drawGlow(ctx, cam, V(0.02, 0.55, -0.02), 0.2, hex('#ff8c59'), 0.34, {
        minPx: 2, maxPx: size * 0.22,
      });
    }
    ctx.restore();

    // Dark outer vignette and a warm pool of light near the bottom.
    const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.27, size / 2, size / 2, size * 0.55);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.72, 'rgba(0, 0, 0, 0.2)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, size, size);
  }

  /* ----------------------------------------------------------
     Particles / effects (screen space)
     ---------------------------------------------------------- */

  function spawnParticle(type, x, y, options = {}) {
    const p = {
      type,
      x, y,
      vx: options.vx ?? 0,
      vy: options.vy ?? 0,
      gravity: options.gravity ?? 0,
      size: options.size ?? 3,
      color: options.color ?? '#ffb24d',
      life: options.life ?? 0.8,
      maxLife: options.life ?? 0.8,
      alpha: options.alpha ?? 1,
      rot: options.rot ?? 0,
      vr: options.vr ?? 0,
    };
    view.particles.push(p);
    if (view.particles.length > 260) view.particles.splice(0, view.particles.length - 260);
  }

  function emitDust(carScreen, state) {
    if (!carScreen || !state || state.v < 2) return;
    const count = state.force > 900 ? 2 : 1;
    for (let i = 0; i < count; i += 1) {
      spawnParticle('dust', carScreen.x - 12 + (seeded() - 0.5) * 14, carScreen.y + 4, {
        vx: -20 - seeded() * 28,
        vy: -7 - seeded() * 12,
        gravity: 2,
        size: 2 + seeded() * 4,
        color: seeded() > 0.6 ? '#c6ad87' : '#8d8069',
        life: 0.45 + seeded() * 0.35,
        alpha: 0.4,
        rot: seeded() * 2,
        vr: (seeded() - 0.5) * 2,
      });
    }
  }

  function emitCrash(state) {
    if (!state || !view.width) return;
    const carZ = 2.25 - (state.travel || 0);
    const cam = cameraForState(state);
    const front = B.project(cam, V(view.carLaneX, 0.85, carZ - 2.1));
    const centerX = front ? front.x : view.width * 0.5;
    const centerY = front ? front.y : view.height * 0.55;
    const severe = state.outcome === 'burn';
    const count = severe ? 34 : 16;
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (seeded() - 0.5) * Math.PI;
      const speed = 20 + seeded() * (severe ? 120 : 55);
      spawnParticle(severe ? 'fire' : 'dust', centerX, centerY, {
        vx: Math.cos(angle) * speed * 0.6,
        vy: Math.sin(angle) * speed - 10,
        gravity: severe ? 90 : 30,
        size: 2 + seeded() * (severe ? 8 : 5),
        color: severe
          ? ['#ffd37a', '#f38b3d', '#d94829', '#ffe9b5'][Math.floor(seeded() * 4)]
          : ['#c7bda8', '#7e9f8d', '#dac09c'][Math.floor(seeded() * 3)],
        life: 0.45 + seeded() * (severe ? 0.8 : 0.4),
        alpha: 0.9,
        rot: seeded() * Math.PI,
        vr: (seeded() - 0.5) * 6,
      });
    }
    for (let i = 0; i < (severe ? 12 : 5); i += 1) {
      spawnParticle('smoke', centerX + (seeded() - 0.5) * 18, centerY + (seeded() - 0.5) * 12, {
        vx: (seeded() - 0.4) * 18,
        vy: -12 - seeded() * 32,
        gravity: -2,
        size: 10 + seeded() * 22,
        color: '#2f302a',
        life: 0.8 + seeded() * 0.9,
        alpha: 0.28,
        rot: seeded() * 1.2,
        vr: (seeded() - 0.5) * 0.8,
      });
    }
  }

  function emitExplosion() {
    const x = view.width * 0.54;
    const y = view.height * 0.56;
    for (let i = 0; i < 64; i += 1) {
      const angle = seeded() * Math.PI * 2;
      const speed = 28 + seeded() * 150;
      spawnParticle('fire', x + (seeded() - 0.5) * 20, y + (seeded() - 0.5) * 16, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 18,
        gravity: 120,
        size: 3 + seeded() * 10,
        color: ['#ffe7a8', '#ffc14c', '#f06b35', '#bd3a23'][Math.floor(seeded() * 4)],
        life: 0.5 + seeded() * 0.9,
        alpha: 1,
        rot: seeded() * Math.PI,
        vr: (seeded() - 0.5) * 7,
      });
    }
    for (let i = 0; i < 14; i += 1) {
      spawnParticle('smoke', x + (seeded() - 0.5) * 24, y + (seeded() - 0.5) * 18, {
        vx: (seeded() - 0.4) * 30,
        vy: -18 - seeded() * 42,
        gravity: -3,
        size: 15 + seeded() * 30,
        color: '#22231f',
        life: 1.2 + seeded() * 1.2,
        alpha: 0.36,
        rot: seeded() * 2,
        vr: (seeded() - 0.5) * 0.6,
      });
    }
  }

  function updateParticles(dt) {
    const ps = view.particles;
    for (let i = ps.length - 1; i >= 0; i -= 1) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > view.height + 30 || p.x < -40 || p.x > view.width + 40) {
        ps.splice(i, 1);
      }
    }
  }

  function drawParticles(ctx) {
    const ps = view.particles;
    for (let i = 0; i < ps.length; i += 1) {
      const p = ps[i];
      const alpha = clamp(p.life / p.maxLife, 0, 1) * p.alpha;
      if (alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      if (p.type === 'fire' && p.size > 6) {
        ctx.fillStyle = 'rgba(255, 245, 200, 0.6)';
        ctx.fillRect(-p.size * 0.16, -p.size * 0.2, p.size * 0.32, p.size * 0.36);
      }
      ctx.restore();
    }
  }

  /* ----------------------------------------------------------
     Main render
     ---------------------------------------------------------- */

  function drawFireBurst(ctx, cam, state) {
    if (!state.exploded) return;
    const age = (state.time || 0) - (state.explosionAt || 0);
    if (age < 0 || age > 0.5) return;
    const carZ = 2.25 - (state.travel || 0);
    const center = B.project(cam, V(view.carLaneX, 0.9, carZ - 1.4));
    if (!center) return;
    const progress = clamp(age / 0.5, 0, 1);
    const radius = 26 + progress * view.width * 0.32;
    ctx.save();
    ctx.globalAlpha = 1 - progress * 0.88;
    ctx.fillStyle = '#ffd05e';
    ctx.beginPath();
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      const rr = radius * (0.62 + seededLike(i + 7) * 0.42);
      const x = center.x + Math.cos(a) * rr;
      const y = center.y + Math.sin(a) * rr * 0.7;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1 - progress * 0.6;
    ctx.fillStyle = '#e85b2d';
    ctx.beginPath();
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2 + 0.2;
      const rr = radius * (0.4 + seededLike(i + 12) * 0.35);
      const x = center.x + Math.cos(a) * rr;
      const y = center.y + Math.sin(a) * rr * 0.65;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function render(state) {
    if (!view.ctx) return;
    view.lastState = state;
    const ctx = view.ctx;
    const w = view.width;
    const h = view.height;
    const cam = cameraForState(state);

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    drawSky(ctx, cam, state);
    drawGround(ctx, cam);
    drawRoad(ctx, cam, state.travel || 0);

    // Car shadow is projected on the road before objects.
    drawCarShadow(ctx, cam, state);
    drawLampShadow(ctx, cam);

    const dynamic = buildCarFaces(state);
    const faces = [];
    for (let i = 0; i < view.staticFaces.length; i += 1) faces.push(view.staticFaces[i]);
    for (let i = 0; i < dynamic.faces.length; i += 1) faces.push(dynamic.faces[i]);

    B.renderFaces(ctx, cam, faces, {
      light: B.normalize(V(0.52, 0.78, 0.35)),
      fogColor: hex('#d0a275'),
      fogNear: 80,
      fogFar: 640,
      ambient: 0.42,
      diffuse: 0.62,
      outline: true,
    });

    drawSignLabels(ctx, cam);
    drawTargetMarker(ctx, cam, state);

    const glows = [];
    if (view.lampGlow) glows.push(view.lampGlow);
    if (view.lampBeaconGlow) glows.push(view.lampBeaconGlow);
    for (let i = 0; i < dynamic.glows.length; i += 1) glows.push(dynamic.glows[i]);
    drawGlows(ctx, cam, glows);

    drawLampBeacon(ctx, cam, state);
    drawFireBurst(ctx, cam, state);
    drawParticles(ctx);

    if (state.ambientDust) {
      // handled by game-side screen ambience if needed
    }
  }

  function bind(mainCanvas, pedalCanvas) {
    view.mainCanvas = mainCanvas;
    view.pedalCanvas = pedalCanvas;
    buildStaticWorld();
    resize();
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => resize());
      ro.observe(mainCanvas);
      ro.observe(pedalCanvas);
      view.resizeObserver = ro;
    } else {
      window.addEventListener('resize', resize);
    }
  }

  function updateEffects(state, dt) {
    view.worldTime += dt;
    updateParticles(dt);
  }

  function emitCarDust(state) {
    if (!state || state.phase !== 'running' || state.v < 3) return;
    const cam = cameraForState(state);
    const p = B.project(cam, V(view.carLaneX - 0.8, 0.3, 2.25 - (state.travel || 0) + 1.35));
    if (p) emitDust(p, state);
  }

  function resetEffects() {
    view.particles.length = 0;
  }

  window.BrakeWorld = {
    bind,
    resize,
    render,
    renderPedal,
    updateEffects,
    emitCarDust,
    resetEffects,
    emitCrash,
    emitExplosion,
    updateParticles,
    getView: () => view,
    colors: COLORS,
  };
})();
