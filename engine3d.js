/* ============================================================
   Brake3D — tiny painter's-algorithm 3D renderer for the
   blocky low-poly world. Designed for Canvas 2D and mobile CPUs.
   ============================================================ */
(function () {
  'use strict';

  const EPS = 1e-6;

  function vec(x, y, z) {
    return { x, y, z };
  }

  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  function scale(a, s) {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  function length(a) {
    return Math.hypot(a.x, a.y, a.z);
  }

  function normalize(a) {
    const l = length(a);
    if (l < EPS) return vec(0, 1, 0);
    return scale(a, 1 / l);
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function hexToRgb(hex) {
    let value = hex.replace('#', '');
    if (value.length === 3) {
      value = value.split('').map((c) => c + c).join('');
    }
    const n = parseInt(value, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToCss(rgb, alpha = 1) {
    return `rgba(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0}, ${alpha})`;
  }

  function mixRgb(a, b, t) {
    return [
      mix(a[0], b[0], t),
      mix(a[1], b[1], t),
      mix(a[2], b[2], t),
    ];
  }

  function scaleRgb(a, s) {
    return [
      clamp(a[0] * s, 0, 255),
      clamp(a[1] * s, 0, 255),
      clamp(a[2] * s, 0, 255),
    ];
  }

  function rotatePoint(p, rotation) {
    if (!rotation) return p;
    let x = p.x;
    let y = p.y;
    let z = p.z;
    const rx = rotation.x || 0;
    const ry = rotation.y || 0;
    const rz = rotation.z || 0;

    if (rx !== 0) {
      const c = Math.cos(rx);
      const s = Math.sin(rx);
      const ny = y * c - z * s;
      const nz = y * s + z * c;
      y = ny;
      z = nz;
    }
    if (ry !== 0) {
      const c = Math.cos(ry);
      const s = Math.sin(ry);
      const nx = x * c + z * s;
      const nz = -x * s + z * c;
      x = nx;
      z = nz;
    }
    if (rz !== 0) {
      const c = Math.cos(rz);
      const s = Math.sin(rz);
      const nx = x * c - y * s;
      const ny = x * s + y * c;
      x = nx;
      y = ny;
    }
    return { x, y, z };
  }

  function transformLocal(p, origin, rotation) {
    const r = rotatePoint(p, rotation);
    return {
      x: r.x + origin.x,
      y: r.y + origin.y,
      z: r.z + origin.z,
    };
  }

  function makeCamera(position, target, fovDeg, width, height) {
    const forward = normalize(sub(target, position));
    const right = normalize(cross(forward, vec(0, 1, 0)));
    const up = cross(right, forward);
    const fov = (fovDeg * Math.PI) / 180;
    return {
      position,
      forward,
      right,
      up,
      width,
      height,
      cx: width * 0.5,
      cy: height * 0.52,
      focal: (height * 0.5) / Math.tan(fov * 0.5),
      near: 0.08,
    };
  }

  function project(cam, p) {
    const dx = p.x - cam.position.x;
    const dy = p.y - cam.position.y;
    const dz = p.z - cam.position.z;
    const depth = dx * cam.forward.x + dy * cam.forward.y + dz * cam.forward.z;
    if (depth <= cam.near) return null;
    const x = dx * cam.right.x + dy * cam.right.y + dz * cam.right.z;
    const y = dx * cam.up.x + dy * cam.up.y + dz * cam.up.z;
    return {
      x: cam.cx + (x / depth) * cam.focal,
      y: cam.cy - (y / depth) * cam.focal,
      depth,
    };
  }

  function horizonY(cam) {
    const h = normalize(vec(cam.forward.x, 0, cam.forward.z));
    const depth = dot(h, cam.forward);
    if (Math.abs(depth) < 0.0001) return cam.cy;
    const up = dot(h, cam.up);
    return cam.cy - (up / depth) * cam.focal;
  }

  /* ----------------------------------------------------------
     Face/material builders
     ---------------------------------------------------------- */

  function material(color, options = {}) {
    return {
      rgb: Array.isArray(color) ? color : hexToRgb(color),
      edge: options.edge === false ? null : (options.edge || null),
      alpha: options.alpha ?? 1,
      emissive: !!options.emissive,
      fog: options.fog !== false,
      edgeWidth: options.edgeWidth ?? 1,
      doubleSided: !!options.doubleSided,
      tag: options.tag || '',
    };
  }

  function addPolygon(faces, points, color, options = {}) {
    if (!points || points.length < 3) return;
    const rgb = color.rgb ? color.rgb : (Array.isArray(color) ? color : hexToRgb(color));
    let edge = options.edge === undefined ? null : options.edge;
    if (typeof edge === 'string') edge = hexToRgb(edge);
    faces.push({
      points,
      color: rgb,
      edge: options.edge === false ? null : edge,
      edgeWidth: options.edgeWidth ?? 1,
      alpha: options.alpha ?? 1,
      emissive: !!options.emissive,
      fog: options.fog !== false,
      tag: options.tag || '',
    });
  }

  function addQuad(faces, a, b, c, d, color, options = {}) {
    addPolygon(faces, [a, b, c, d], color, options);
  }

  function addBox(faces, options) {
    const {
      x = 0, y = 0, z = 0,
      w = 1, h = 1, d = 1,
      color = '#ffffff',
      edge = null,
      rot = null,
      alpha = 1,
      emissive = false,
      fog = true,
      edgeWidth = 1,
      tag = '',
    } = options;

    const local = [
      { x: -w / 2, y: 0, z: -d / 2 }, // 0
      { x: w / 2, y: 0, z: -d / 2 },  // 1
      { x: w / 2, y: 0, z: d / 2 },   // 2
      { x: -w / 2, y: 0, z: d / 2 },  // 3
      { x: -w / 2, y: h, z: -d / 2 }, // 4
      { x: w / 2, y: h, z: -d / 2 },  // 5
      { x: w / 2, y: h, z: d / 2 },   // 6
      { x: -w / 2, y: h, z: d / 2 },  // 7
    ];
    const origin = vec(x, y, z);
    const p = local.map((point) => transformLocal(point, origin, rot));
    const options2 = { edge, alpha, emissive, fog, edgeWidth, tag };

    // +X, -X, +Y, -Y, +Z, -Z
    addQuad(faces, p[1], p[5], p[6], p[2], color, options2);
    addQuad(faces, p[3], p[7], p[4], p[0], color, options2);
    addQuad(faces, p[7], p[6], p[5], p[4], color, options2);
    addQuad(faces, p[0], p[1], p[2], p[3], color, options2);
    addQuad(faces, p[3], p[2], p[6], p[7], color, options2);
    addQuad(faces, p[1], p[0], p[4], p[5], color, options2);
  }

  function addPlane(faces, options) {
    const {
      points,
      origin = vec(0, 0, 0),
      rot = null,
      color = '#ffffff',
      edge = null,
      alpha = 1,
      emissive = false,
      fog = true,
      edgeWidth = 1,
      tag = '',
    } = options;
    const worldPoints = points.map((p) => transformLocal(p, origin, rot));
    addPolygon(faces, worldPoints, color, {
      edge, alpha, emissive, fog, edgeWidth, tag,
    });
  }

  function addPyramid(faces, options) {
    const {
      x = 0, y = 0, z = 0,
      w = 1, h = 1, d = 1,
      color = '#ffffff',
      edge = null,
      rot = null,
      alpha = 1,
      fog = true,
      tag = '',
    } = options;
    const origin = vec(x, y, z);
    const apex = transformLocal(vec(0, h, 0), origin, rot);
    const base = [
      vec(-w / 2, 0, -d / 2),
      vec(w / 2, 0, -d / 2),
      vec(w / 2, 0, d / 2),
      vec(-w / 2, 0, d / 2),
    ].map((p) => transformLocal(p, origin, rot));

    for (let i = 0; i < 4; i += 1) {
      const a = base[i];
      const b = base[(i + 1) % 4];
      addPolygon(faces, [a, b, apex], color, {
        edge, alpha, fog, tag,
      });
    }
  }

  function addCylinderX(faces, options) {
    const {
      x = 0, y = 0, z = 0,
      radius = 0.3,
      width = 0.2,
      sides = 10,
      color = '#111111',
      capColor = null,
      edge = null,
      rot = null,
      fog = true,
      tag = '',
      alpha = 1,
    } = options;
    const origin = vec(x, y, z);
    const half = width / 2;
    const left = [];
    const right = [];
    for (let i = 0; i < sides; i += 1) {
      const a = (i / sides) * Math.PI * 2;
      const py = Math.cos(a) * radius;
      const pz = Math.sin(a) * radius;
      left.push(transformLocal(vec(-half, py, pz), origin, rot));
      right.push(transformLocal(vec(half, py, pz), origin, rot));
    }
    for (let i = 0; i < sides; i += 1) {
      const j = (i + 1) % sides;
      addQuad(faces, left[i], right[i], right[j], left[j], color, {
        edge, fog, tag, alpha,
      });
    }
    addPolygon(faces, right, capColor || color, { edge, fog, tag, alpha });
    addPolygon(faces, left, capColor || color, { edge, fog, tag, alpha });
  }

  /* ----------------------------------------------------------
     Renderer
     ---------------------------------------------------------- */

  function renderFaces(ctx, cam, faces, options = {}) {
    const {
      light = normalize(vec(-0.35, 0.8, 0.5)),
      fogColor = hexToRgb('#d4a477'),
      fogNear = 90,
      fogFar = 720,
      ambient = 0.44,
      diffuse = 0.62,
      edgeAlpha = 0.32,
      outline = true,
      screenHeight = cam.height,
    } = options;

    const drawList = [];
    const lightNormalized = normalize(light);

    for (let i = 0; i < faces.length; i += 1) {
      const face = faces[i];
      if (!face || !face.points || face.points.length < 3) continue;
      const projected = [];
      let depthSum = 0;
      let visible = true;
      for (let j = 0; j < face.points.length; j += 1) {
        const p = project(cam, face.points[j]);
        if (!p) {
          visible = false;
          break;
        }
        projected.push(p);
        depthSum += p.depth;
      }
      if (!visible) continue;
      const depth = depthSum / projected.length;
      if (depth > 900) continue;

      // Approximate screen bounds for cheap off-screen culling.
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let j = 0; j < projected.length; j += 1) {
        const p = projected[j];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (maxX < -80 || minX > cam.width + 80 || maxY < -80 || minY > cam.height + 80) {
        continue;
      }

      let rgb;
      let alpha = face.alpha ?? 1;
      let fog = 0;
      if (face.emissive) {
        rgb = face.color;
      } else {
        const a = face.points[0];
        const b = face.points[1];
        const c = face.points[2];
        let normal = normalize(cross(sub(b, a), sub(c, a)));
        const toCam = sub(cam.position, a);
        if (dot(normal, toCam) < 0) {
          normal = scale(normal, -1);
        }
        const lambert = Math.max(0, dot(normal, lightNormalized));
        const sky = Math.max(0, normal.y) * 0.12;
        const shade = clamp(ambient + diffuse * lambert + sky, 0.22, 1.22);
        rgb = scaleRgb(face.color, shade);
        // Slightly warm the highlights toward the sunset.
        rgb = mixRgb(rgb, [255, 220, 176], lambert * 0.07);
        if (face.fog !== false) {
          fog = smoothstep(fogNear, fogFar, depth) * 0.82;
          rgb = mixRgb(rgb, fogColor, fog);
        }
      }

      let edge = null;
      if (outline && face.edge) {
        edge = face.edge;
        const fa = Math.max(0.06, (1 - fog) * 0.8);
        edge = [edge[0], edge[1], edge[2], fa];
      }

      drawList.push({
        p: projected,
        depth,
        color: rgb,
        alpha,
        edge,
        edgeWidth: face.edgeWidth || 1,
        glow: face.emissive,
        fog,
      });
    }

    drawList.sort((a, b) => b.depth - a.depth);

    for (let i = 0; i < drawList.length; i += 1) {
      const item = drawList[i];
      const pts = item.p;
      if (!pts || pts.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let j = 1; j < pts.length; j += 1) {
        ctx.lineTo(pts[j].x, pts[j].y);
      }
      ctx.closePath();
      ctx.globalAlpha = item.alpha;
      ctx.fillStyle = rgbToCss(item.color, 1);
      ctx.fill();
      if (item.edge) {
        ctx.strokeStyle = rgbToCss(item.edge, item.edge[3]);
        ctx.lineWidth = item.edgeWidth;
        ctx.lineJoin = 'miter';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    return drawList;
  }

  function drawGlow(ctx, cam, worldPoint, radiusWorld, color, strength = 1, options = {}) {
    const p = project(cam, worldPoint);
    if (!p) return;
    const rgb = typeof color === 'string' ? hexToRgb(color) : color;
    const minPx = options.minPx ?? 2;
    const maxPx = options.maxPx ?? 140;
    const screenRadius = clamp((radiusWorld / Math.max(1, p.depth)) * cam.focal, minPx, maxPx);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, screenRadius);
    g.addColorStop(0, rgbToCss(rgb, 0.34 * strength));
    g.addColorStop(0.3, rgbToCss(rgb, 0.2 * strength));
    g.addColorStop(1, rgbToCss(rgb, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, screenRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  window.Brake3D = {
    vec,
    sub,
    add,
    scale,
    dot,
    cross,
    length,
    normalize,
    mix,
    clamp,
    smoothstep,
    hexToRgb,
    rgbToCss,
    mixRgb,
    scaleRgb,
    rotatePoint,
    transformLocal,
    makeCamera,
    project,
    horizonY,
    material,
    addPolygon,
    addQuad,
    addBox,
    addPlane,
    addPyramid,
    addCylinderX,
    renderFaces,
    drawGlow,
  };
})();
