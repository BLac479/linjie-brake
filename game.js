/* ============================================================
   临“界”刹车 — game logic, HUD, input and the EV braking model.
   ============================================================ */
(() => {
  'use strict';

  const CFG = {
    startKph: 120,
    distance: 500,
    survivalKph: 34,
    breakForce: 1400,
    gaugeMax: 1500,
    mass: 1600,
    regenMax: 3600,
    dragK: 0.22,
    // Rolling resistance coefficient of the road surface. This is the
    // tiny natural deceleration felt even when the brake pedal is released.
    rollingCoef: 0.008,
    // Initial pedal bite is deliberately strong, then the rate tapers
    // toward a slow creep so the last part of the travel takes patience.
    risePerSec: 760,
    riseTau: 1.0,
    riseFloor: 0.11,
    fallPerSec: 420,
    safeLow: 900,
    warnAt: 1300,
    fixedStep: 1 / 120,
    stopEpsilon: 0.015,
  };

  const V0 = CFG.startKph / 3.6;
  const GRAVITY = 9.81;
  const STORE_ENDINGS = 'brake500.endings.v1';
  const STORE_SOUND = 'brake500.sound.v1';
  const STORE_VEHICLE = 'brake500.vehicle.v1';
  const NS = 'http://www.w3.org/2000/svg';

  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const lerp = (a, b, t) => a + (b - a) * t;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const dom = {
    app: $('#app'),
    scene: $('#scene'),
    pedalScene: $('#pedalScene'),
    distanceHud: $('.distance-hud'),
    distanceValue: $('#distanceValue'),
    soundToggle: $('#soundToggle'),
    soundLabel: $('#soundLabel'),
    speedDial: $('#speedDial'),
    speedValue: $('#speedValue'),
    speedWhole: $('#speedWhole'),
    speedFraction: $('#speedFraction'),
    regenValue: $('#regenValue'),
    regenFill: $('#regenFill'),
    assistCluster: $('.assist-cluster'),
    assistStatus: $('#assistStatus'),
    projectedStop: $('#projectedStop'),
    brakeZone: $('#brakeZone'),
    pedalCaption: $('.pedal-caption'),
    pressureState: $('#pressureState'),
    forceValue: $('#forceValue'),
    pressureGauge: $('#pressureGauge'),
    pressureFill: $('#pressureFill'),
    pressureNeedle: $('#pressureNeedle'),
    snapBanner: $('#snapBanner'),
    coach: $('#coach'),
    countdown: $('#countdown'),
    countdownKicker: $('#countdownKicker'),
    countdownNumber: $('#countdownNumber'),
    countdownHint: $('#countdownHint'),
    introOverlay: $('#introOverlay'),
    startButton: $('#startButton'),
    introEndings: $('#introEndings'),
    endingCount: $('#endingCount'),
    introVehicleName: $('#introVehicleName'),
    vehicleCards: $$('.vehicle-card'),
    selectedVehicleLabel: $('#selectedVehicleLabel'),
    menuButton: $('#menuButton'),
    pauseOverlay: $('#pauseOverlay'),
    pauseFrame: $('#pauseFrame'),
    pauseClose: $('#pauseClose'),
    pauseHome: $('#pauseHome'),
    pauseRestart: $('#pauseRestart'),
    pauseVehicle: $('#pauseVehicle'),
    resultOverlay: $('#resultOverlay'),
    resultFrame: $('#resultFrame'),
    resultKicker: $('#resultKicker'),
    resultCode: $('#resultCode'),
    resultTitle: $('#resultTitle'),
    resultSub: $('#resultSub'),
    resultStamp: $('#resultStamp'),
    resultStory: $('#resultStory'),
    resultStats: $('#resultStats'),
    meterLabel: $('#meterLabel'),
    meterValue: $('#meterValue'),
    meterFill: $('#meterFill'),
    meterLimit: $('#meterLimit'),
    meterScaleStart: $('#meterScaleStart'),
    meterScaleMid: $('#meterScaleMid'),
    meterScaleEnd: $('#meterScaleEnd'),
    resultEndings: $('#resultEndings'),
    resultEndingCount: $('#resultEndingCount'),
    retryButton: $('#retryButton'),
    homeButton: $('#homeButton'),
    screenFlash: $('#screenFlash'),
  };

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = reducedMotionQuery.matches;
  reducedMotionQuery.addEventListener?.('change', (e) => {
    reducedMotion = e.matches;
  });

  /* ----------------------------------------------------------
     Persistence
     ---------------------------------------------------------- */

  const endingIds = ['perfect', 'lucky', 'burn'];

  function safeRead(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function safeWrite(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* file:// / private mode is allowed to fail silently */
    }
  }

  function loadEndings() {
    try {
      const parsed = JSON.parse(safeRead(STORE_ENDINGS, '[]'));
      return new Set(Array.isArray(parsed) ? parsed.filter((id) => endingIds.includes(id)) : []);
    } catch {
      return new Set();
    }
  }

  const unlocked = loadEndings();

  const vehicleMeta = {
    suv: { short: 'SUV', name: '纯电 SUV', intro: 'SUV' },
    mpv: { short: 'MPV', name: '豪华 MPV', intro: '豪华 MPV' },
  };

  function loadVehicle() {
    const saved = safeRead(STORE_VEHICLE, 'suv');
    return saved === 'mpv' ? 'mpv' : 'suv';
  }

  function saveEndings() {
    safeWrite(STORE_ENDINGS, JSON.stringify(Array.from(unlocked)));
  }

  function unlockEnding(id) {
    if (!endingIds.includes(id) || unlocked.has(id)) return false;
    unlocked.add(id);
    saveEndings();
    paintEndingChips(dom.introEndings);
    paintEndingChips(dom.resultEndings);
    return true;
  }

  function paintEndingChips(container) {
    if (!container) return;
    $$('.ending-chip', container).forEach((chip) => {
      const id = chip.dataset.ending;
      const isOpen = unlocked.has(id);
      chip.classList.toggle('is-unlocked', isOpen);
      const small = $('small', chip);
      if (small) small.textContent = isOpen ? '已解锁' : '未解锁';
    });
    const count = `${unlocked.size} / ${endingIds.length}`;
    if (container === dom.introEndings) dom.endingCount.textContent = count;
    if (container === dom.resultEndings) dom.resultEndingCount.textContent = count;
  }

  /* ----------------------------------------------------------
     Sound
     ---------------------------------------------------------- */

  let soundOn = safeRead(STORE_SOUND, 'on') !== 'off';
  let audioCtx = null;
  let master = null;
  let noiseBuffer = null;

  const audio = {
    init() {
      if (!soundOn) return;
      if (audioCtx) {
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        return;
      }
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      try {
        audioCtx = new Ctor();
        master = audioCtx.createGain();
        master.gain.value = 0.48;
        master.connect(audioCtx.destination);
        const len = Math.floor(audioCtx.sampleRate * 1.2);
        noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      } catch {
        audioCtx = null;
        master = null;
      }
    },
    gate() {
      if (!soundOn || !audioCtx || !master) return false;
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return true;
    },
    tone(freq, duration = 0.08, volume = 0.04, type = 'square', delay = 0, endFreq = null) {
      if (!this.gate()) return;
      const start = audioCtx.currentTime + delay;
      const end = start + duration;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(30, freq), start);
      if (endFreq !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), end);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(end + 0.025);
    },
    noise(duration = 0.22, volume = 0.1, type = 'lowpass', frequency = 500, delay = 0) {
      if (!this.gate() || !noiseBuffer) return;
      const start = audioCtx.currentTime + delay;
      const src = audioCtx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = 0.8;
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(start);
      src.stop(start + duration + 0.02);
    },
    tick(go = false) {
      this.tone(go ? 760 : 430, go ? 0.09 : 0.045, go ? 0.05 : 0.032, 'square');
    },
    pedal() {
      this.noise(0.14, 0.042, 'highpass', 1300);
      this.tone(118, 0.12, 0.025, 'triangle', 0, 84);
    },
    warning() {
      this.tone(1160, 0.065, 0.032, 'square');
      this.tone(1160, 0.06, 0.024, 'square', 0.12);
    },
    snap() {
      this.noise(0.2, 0.19, 'highpass', 1700);
      this.tone(320, 0.22, 0.08, 'sawtooth', 0, 88);
      this.noise(0.48, 0.11, 'bandpass', 420, 0.04);
    },
    crashLight() {
      this.noise(0.3, 0.21, 'lowpass', 420);
      this.tone(96, 0.32, 0.1, 'triangle', 0, 48);
    },
    crashHeavy() {
      this.noise(0.52, 0.24, 'lowpass', 330);
      this.tone(82, 0.45, 0.11, 'sawtooth', 0, 36);
    },
    explosion() {
      this.noise(1.1, 0.33, 'lowpass', 250);
      this.tone(55, 1.05, 0.14, 'sine', 0, 27);
    },
    win() {
      this.tone(392, 0.13, 0.045, 'sine', 0);
      this.tone(523.25, 0.16, 0.045, 'sine', 0.12);
      this.tone(659.25, 0.38, 0.045, 'sine', 0.26);
    },
    ui() {
      this.tone(590, 0.045, 0.02, 'square');
    },
  };

  function updateSoundUI() {
    dom.soundToggle.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    dom.soundToggle.setAttribute('aria-label', soundOn ? '关闭音效' : '开启音效');
    dom.soundLabel.textContent = soundOn ? 'SFX ON' : 'OFF';
  }

  updateSoundUI();

  dom.soundToggle.addEventListener('click', () => {
    soundOn = !soundOn;
    safeWrite(STORE_SOUND, soundOn ? 'on' : 'off');
    updateSoundUI();
    if (soundOn) {
      audio.init();
      audio.ui();
    }
  });

  /* ----------------------------------------------------------
     State
     ---------------------------------------------------------- */

  const state = {
    phase: 'intro',
    clock: 0,
    phaseStart: 0,
    time: 0,
    v: V0,
    gap: CFG.distance,
    travel: 0,
    force: 0,
    holdTime: 0,
    regen: 0,
    drag: 0,
    maxForce: 0,
    maxRegen: 0,
    snapForce: 0,
    snapped: false,
    pointerHeld: false,
    keyHeld: false,
    activePointers: new Set(),
    countdownStage: 0,
    countdownStart: 0,
    coachShown: false,
    warningNextAt: 0,
    wheelAngle: 0,
    pedalDepress: 0,
    shake: 0,
    flash: 0,
    dustTimer: 0,
    crashAt: 0,
    resultAt: 0,
    resultShown: false,
    exploded: false,
    explosionAt: 0,
    impactKph: 0,
    outcome: null,
    crashReason: null,
    stopGap: 0,
    accumulator: 0,
    introSkipped: false,
    vehicle: loadVehicle(),
    paused: false,
  };

  let needle = null;
  let introHideTimer = 0;
  let resultHideTimer = 0;
  let activeAttemptStarted = false;

  function setPhase(next) {
    state.phase = next;
    state.phaseStart = state.clock;
    state.accumulator = 0;
    dom.app.dataset.phase = next;
  }

  function setText(node, value) {
    if (node && node.textContent !== String(value)) node.textContent = String(value);
  }

  function paintVehicleSelection() {
    const meta = vehicleMeta[state.vehicle] || vehicleMeta.suv;
    dom.vehicleCards.forEach((card) => {
      const selected = card.dataset.vehicle === state.vehicle;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    setText(dom.introVehicleName, meta.intro);
    setText(dom.selectedVehicleLabel, meta.short);
    setText(dom.pauseVehicle, meta.name);
    dom.app.dataset.vehicle = state.vehicle;
  }

  function setVehicle(next) {
    if (!vehicleMeta[next] || next === state.vehicle) return;
    if (state.phase !== 'intro' || state.paused) return;
    state.vehicle = next;
    safeWrite(STORE_VEHICLE, next);
    paintVehicleSelection();
    audio.init();
    audio.ui();
  }

  dom.vehicleCards.forEach((card) => {
    card.addEventListener('click', () => setVehicle(card.dataset.vehicle));
  });

  /* ----------------------------------------------------------
     Speedometer construction & UI
     ---------------------------------------------------------- */

  function polarPoint(cx, cy, radius, degrees) {
    const rad = (degrees * Math.PI) / 180;
    return {
      x: cx + Math.cos(rad) * radius,
      y: cy + Math.sin(rad) * radius,
    };
  }

  function createSvgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      el.setAttribute(key, String(value));
    }
    return el;
  }

  function buildSpeedDial() {
    const svg = dom.speedDial;
    svg.innerHTML = '';
    const cx = 110;
    const cy = 110;
    const startAngle = 135;
    const sweep = 270;

    // faint outer speed arc
    const arcStart = polarPoint(cx, cy, 94, startAngle);
    const arcEnd = polarPoint(cx, cy, 94, startAngle + sweep);
    svg.appendChild(createSvgEl('path', {
      d: `M ${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)} A 94 94 0 1 1 ${arcEnd.x.toFixed(2)} ${arcEnd.y.toFixed(2)}`,
      class: 'dial-arc',
      'stroke-dasharray': '2 8',
      opacity: '0.7',
    }));

    // amber high-speed sector
    const hiA = polarPoint(cx, cy, 94, startAngle + sweep * (120 / 160));
    const hiB = polarPoint(cx, cy, 94, startAngle + sweep);
    svg.appendChild(createSvgEl('path', {
      d: `M ${hiA.x.toFixed(2)} ${hiA.y.toFixed(2)} A 94 94 0 0 1 ${hiB.x.toFixed(2)} ${hiB.y.toFixed(2)}`,
      class: 'dial-arc warn',
      opacity: '0.8',
    }));

    for (let speed = 0; speed <= 160; speed += 10) {
      const angle = startAngle + sweep * (speed / 160);
      const isMajor = speed % 20 === 0;
      const radiusOuter = 92;
      const radiusInner = isMajor ? 81 : 86;
      const a = polarPoint(cx, cy, radiusInner, angle);
      const b = polarPoint(cx, cy, radiusOuter, angle);
      svg.appendChild(createSvgEl('line', {
        x1: a.x.toFixed(2),
        y1: a.y.toFixed(2),
        x2: b.x.toFixed(2),
        y2: b.y.toFixed(2),
        class: `dial-tick${isMajor ? ' major' : ''}`,
      }));
      if (speed % 40 === 0) {
        const label = polarPoint(cx, cy, 70, angle);
        const text = createSvgEl('text', {
          x: label.x.toFixed(2),
          y: label.y.toFixed(2),
          class: 'dial-tick-label',
        });
        text.textContent = String(speed);
        svg.appendChild(text);
      }
    }

    const needleGroup = createSvgEl('g', {
      id: 'speedNeedle',
      transform: `rotate(${startAngle + sweep * (CFG.startKph / 160)} ${cx} ${cy})`,
    });
    needleGroup.appendChild(createSvgEl('line', {
      x1: cx,
      y1: cy,
      x2: cx + 83,
      y2: cy,
      class: 'dial-needle-shadow',
    }));
    needleGroup.appendChild(createSvgEl('line', {
      x1: cx,
      y1: cy,
      x2: cx + 83,
      y2: cy,
      class: 'dial-needle',
    }));
    svg.appendChild(needleGroup);
    needle = needleGroup;

    svg.appendChild(createSvgEl('circle', {
      cx, cy, r: 9.5, class: 'dial-hub',
    }));
    svg.appendChild(createSvgEl('circle', {
      cx, cy, r: 4.2, class: 'dial-hub-center',
    }));
  }

  function speedAngle(speed) {
    return 135 + 270 * clamp(speed / 160, 0, 1);
  }

  function projectedStop() {
    if (state.phase !== 'running' || state.snapped || state.v <= 0.05) return null;
    const pedal = state.force;
    const regen = computeRegen(pedal, state.v);
    const drag = computeDrag(state.v);
    const decel = (pedal + regen + drag) / CFG.mass;
    if (decel < 0.03) return null;
    return (state.v * state.v) / (2 * decel);
  }

  function updateUI(dt) {
    const speed = Math.max(0, state.v * 3.6);
    const displaySpeed = speed.toFixed(1);
    const [wholeSpeed, tenthSpeed] = displaySpeed.split('.');
    setText(dom.speedWhole, wholeSpeed);
    setText(dom.speedFraction, `.${tenthSpeed}`);
    if (needle) needle.setAttribute('transform', `rotate(${speedAngle(speed).toFixed(2)} 110 110)`);

    setText(dom.distanceValue, state.gap > 0 ? state.gap.toFixed(1) : '0.0');
    const projected = projectedStop();
    const danger = projected !== null && projected > state.gap + 4;
    dom.distanceHud.classList.toggle('is-danger', danger || state.snapped);
    if (state.phase === 'running' && !state.snapped && projected !== null && projected < 900) {
      setText(dom.projectedStop, Math.round(projected));
      dom.projectedStop.classList.toggle('is-danger', danger);
    } else {
      setText(dom.projectedStop, '—');
      dom.projectedStop.classList.remove('is-danger');
    }

    setText(dom.regenValue, Math.round(state.regen));
    const regenRatio = clamp(state.regen / CFG.regenMax, 0, 1);
    dom.regenFill.style.transform = `scaleX(${regenRatio})`;
    dom.assistCluster.classList.toggle('is-assisting', state.regen > 20 && state.phase === 'running');
    dom.assistCluster.classList.toggle('is-warn', state.force >= CFG.warnAt || state.snapped);

    let assistLabel = '电制动待命';
    if (state.phase === 'countdown') assistLabel = '电制动待命';
    else if (state.phase === 'running') {
      if (state.snapped) assistLabel = '电制动切断';
      else if (state.regen > 20) assistLabel = 'E‑REGEN 协同制动';
      else assistLabel = '等待液压制动';
    } else if (state.phase === 'stopped') assistLabel = '车辆已停稳';
    else if (state.phase === 'crash' || state.phase === 'ended') assistLabel = state.snapped ? '制动系统失效' : '事故终止';
    setText(dom.assistStatus, assistLabel);

    const forceDisplay = state.snapped ? '1400+' : Math.round(state.force);
    setText(dom.forceValue, forceDisplay);
    const forceRatio = clamp((state.snapped ? CFG.gaugeMax : state.force) / CFG.gaugeMax, 0, 1);
    dom.pressureFill.style.transform = `scaleX(${forceRatio})`;
    dom.pressureNeedle.style.left = `${forceRatio * 100}%`;

    let fillClass = '';
    if (state.snapped) fillClass = 'is-broken';
    else if (state.force >= CFG.warnAt) fillClass = 'is-warn';
    else if (state.force >= CFG.safeLow) fillClass = 'is-safe';
    dom.pressureFill.className = `pressure-fill ${fillClass}`.trim();

    let pressureClass = '';
    let pressureLabel = '待命';
    if (state.phase === 'stopped' || (state.phase === 'ended' && state.outcome === 'perfect')) {
      pressureClass = 'is-safe';
      pressureLabel = '车辆停稳';
    } else if (state.phase === 'crash' || state.phase === 'ended') {
      pressureClass = state.snapped ? 'is-broken' : 'is-low';
      pressureLabel = state.snapped ? '回路断裂' : '碰撞';
    } else if (state.snapped) {
      pressureClass = 'is-broken';
      pressureLabel = '回路断裂';
    } else if (state.force >= CFG.warnAt) {
      pressureClass = 'is-warn';
      pressureLabel = '接近断点';
    } else if (state.force >= CFG.safeLow) {
      pressureClass = 'is-safe';
      pressureLabel = '有效制动';
    } else if (state.force > 20) {
      if (state.phase === 'running' && projected !== null && projected <= state.gap) {
        pressureClass = 'is-safe';
        pressureLabel = '电制动协同';
      } else {
        pressureClass = 'is-low';
        pressureLabel = '压力不足';
      }
    } else if (state.phase === 'running') {
      pressureClass = 'is-low';
      pressureLabel = '未制动';
    }
    const stateClass = `pressure-state ${pressureClass}`.trim();
    if (dom.pressureState.className !== stateClass) dom.pressureState.className = stateClass;
    setText(dom.pressureState, pressureLabel);

    const held = state.phase === 'running' || state.phase === 'countdown'
      ? (state.pointerHeld || state.keyHeld)
      : false;
    dom.brakeZone.classList.toggle('is-held', held && !state.snapped);
    dom.brakeZone.setAttribute('aria-pressed', held && !state.snapped ? 'true' : 'false');

    let pedalTitle = '按住刹车';
    let pedalSub = 'HOLD';
    if (state.snapped) {
      pedalTitle = '踏板失效';
      pedalSub = 'FAILED';
    } else if (state.phase === 'stopped' || (state.phase === 'ended' && state.outcome === 'perfect')) {
      pedalTitle = '车辆停稳';
      pedalSub = 'STOPPED';
    } else if (state.phase === 'crash' || state.phase === 'ended') {
      pedalTitle = '碰撞';
      pedalSub = 'IMPACT';
    } else if (held) {
      pedalTitle = '制动中';
      pedalSub = 'BRAKING';
    }
    setText(dom.pedalCaption, `${pedalTitle} / ${pedalSub}`);

    const targetPress = state.phase === 'running' && !state.snapped
      ? clamp(state.force / CFG.breakForce, 0, 1) * 0.82 + (held ? 0.08 : 0)
      : state.phase === 'countdown' && held
        ? 0.12
        : 0;
    state.pedalDepress = lerp(state.pedalDepress, targetPress, Math.min(1, dt * 11));
  }

  /* ----------------------------------------------------------
     Physics
     ---------------------------------------------------------- */

  function computeRegen(pedal, speed) {
    if (pedal <= 0.5 || state.snapped) return 0;
    const ratio = clamp(pedal / CFG.breakForce, 0, 1);
    const speedFactor = 0.55 + 0.45 * clamp(speed / V0, 0, 1);
    return CFG.regenMax * ratio * ratio * speedFactor;
  }

  function computeDrag(speed) {
    const rolling = CFG.rollingCoef * CFG.mass * GRAVITY;
    return CFG.dragK * speed * speed + rolling;
  }

  function currentInputHeld() {
    return state.pointerHeld || state.keyHeld;
  }

  function canUsePedal() {
    return !state.paused && (state.phase === 'running' || state.phase === 'countdown') && !state.snapped;
  }

  function hideCoach() {
    if (!dom.coach.hidden) dom.coach.hidden = true;
  }

  function clearInput() {
    state.activePointers.clear();
    state.pointerHeld = false;
    state.keyHeld = false;
    state.holdTime = 0;
    dom.brakeZone.classList.remove('is-held');
    dom.brakeZone.setAttribute('aria-pressed', 'false');
  }

  function triggerSnap(rawForce) {
    if (state.snapped) return;
    state.snapped = true;
    state.snapForce = Math.max(CFG.breakForce + 1, rawForce);
    state.maxForce = Math.max(state.maxForce, state.snapForce);
    state.force = CFG.breakForce;
    state.holdTime = 0;
    state.regen = 0;
    state.pointerHeld = false;
    state.keyHeld = false;
    state.activePointers.clear();
    state.shake = 20;
    state.flash = 0.45;
    dom.brakeZone.disabled = true;
    dom.brakeZone.classList.remove('is-held', 'needs-hint');
    dom.brakeZone.classList.add('is-disabled');
    dom.brakeZone.setAttribute('aria-pressed', 'false');
    dom.snapBanner.hidden = false;
    hideCoach();
    audio.snap();
    flashScreen('rgba(239,79,60,.55)', 430);
    vibrate([30, 35, 90]);
  }

  function resolveStop() {
    if (state.phase !== 'running') return;
    state.v = 0;
    state.phase = 'stopped';
    state.phaseStart = state.clock;
    dom.app.dataset.phase = 'stopped';
    state.force = 0;
    state.regen = 0;
    state.stopGap = state.gap;
    state.outcome = 'perfect';
    state.resultShown = false;
    state.resultAt = state.clock + 0.95;
    state.shake = Math.min(state.shake, 1.5);
    clearInput();
    dom.brakeZone.disabled = true;
    dom.brakeZone.classList.remove('needs-hint');
    dom.brakeZone.classList.add('is-disabled');
    hideCoach();
    dom.snapBanner.hidden = true;
    audio.win();
    updateUI(0.016);
  }

  function resolveCollision(impactV) {
    if (state.phase !== 'running') return;
    const kmh = impactV * 3.6;
    state.impactKph = kmh;
    state.v = 0;
    state.gap = 0;
    state.travel = CFG.distance;
    clearInput();
    dom.brakeZone.disabled = true;
    dom.brakeZone.classList.remove('needs-hint');
    dom.brakeZone.classList.add('is-disabled');
    hideCoach();
    dom.snapBanner.hidden = true;

    if (state.snapped) {
      state.outcome = 'burn';
      state.crashReason = 'snapped';
    } else if (kmh < CFG.survivalKph) {
      state.outcome = 'lucky';
      state.crashReason = 'lowspeed';
    } else {
      state.outcome = 'burn';
      state.crashReason = 'overspeed';
    }

    setPhase('crash');
    state.crashAt = state.clock;
    state.resultShown = false;
    state.exploded = false;
    state.shake = state.outcome === 'lucky' ? 11 : 25;
    state.flash = 0.25;
    state.regen = 0;
    state.force = Math.min(state.force, CFG.breakForce);

    if (state.outcome === 'lucky') {
      state.resultAt = state.clock + 1.15;
      audio.crashLight();
      BrakeWorld.emitCrash(state);
      flashScreen('rgba(250, 245, 235, 0.28)', 340);
      vibrate([55, 30, 110]);
    } else {
      state.resultAt = state.clock + 2.35;
      audio.crashHeavy();
      BrakeWorld.emitCrash(state);
      vibrate([80, 35, 140]);
    }
    updateUI(0.016);
  }

  function snapWarningTick() {
    if (state.phase !== 'running' || state.snapped) return;
    if (state.force >= CFG.warnAt && state.clock >= state.warningNextAt) {
      state.warningNextAt = state.clock + 0.65;
      audio.warning();
    }
  }

  function stepPhysics(dt) {
    if (state.phase !== 'running') return;

    if (!state.snapped) {
      const held = currentInputHeld();
      if (held) {
        state.holdTime += dt;
        // The first part of the pedal travel is quick, then the pressure
        // builds asymptotically toward the hydraulic limit.
        const riseFactor = CFG.riseFloor
          + (1 - CFG.riseFloor) * Math.exp(-state.holdTime / CFG.riseTau);
        state.force += CFG.risePerSec * riseFactor * dt;
        if (state.force > CFG.breakForce) {
          triggerSnap(state.force);
        }
      } else {
        state.holdTime = 0;
        state.force = Math.max(0, state.force - CFG.fallPerSec * dt);
      }
      state.maxForce = Math.max(state.maxForce, state.force);
    }

    const speed = state.v;
    if (speed <= 0) return;

    let decel = 0;
    if (!state.snapped) {
      const regen = computeRegen(state.force, speed);
      const drag = computeDrag(speed);
      state.regen = regen;
      state.drag = drag;
      state.maxRegen = Math.max(state.maxRegen, regen);
      decel = (state.force + regen + drag) / CFG.mass;
    } else {
      state.regen = 0;
      state.drag = 0;
      decel = 0;
    }

    const v0 = state.v;
    const v1 = Math.max(0, v0 - decel * dt);
    const distance = ((v0 + v1) / 2) * dt;

    if (distance > 0) {
      if (distance >= state.gap) {
        if (v1 <= 0.05) {
          state.travel += state.gap;
          state.gap = 0;
          state.v = 0;
          resolveStop();
          return;
        }
        const fraction = clamp(state.gap / distance, 0, 1);
        const impactV = v0 + (v1 - v0) * fraction;
        state.v = 0;
        state.gap = 0;
        resolveCollision(impactV);
        return;
      }
      state.gap -= distance;
      state.travel += distance;
      state.v = v1;
      state.wheelAngle += ((v0 + v1) / 2) * dt / 0.38 * 0.16;
    }

    if (state.v <= CFG.stopEpsilon && state.gap > 0) {
      state.v = 0;
      resolveStop();
    }
  }

  function updateCountdown() {
    const t = state.clock - state.phaseStart;
    if (state.countdownStage === 0 && t >= 0.85) {
      state.countdownStage = 1;
      showCountdownStep('2', '准备制动', false);
    } else if (state.countdownStage === 1 && t >= 1.5) {
      state.countdownStage = 2;
      showCountdownStep('1', '盯住路灯', false);
    } else if (state.countdownStage === 2 && t >= 2.15) {
      state.countdownStage = 3;
      showCountdownStep('GO', '松开 · 踩下刹车', true);
    } else if (state.countdownStage === 3 && t >= 2.65) {
      beginRunning();
    }
  }

  function showCountdownStep(label, hint, isGo) {
    dom.countdownNumber.textContent = label;
    dom.countdownHint.textContent = hint;
    dom.countdownNumber.classList.toggle('is-go', isGo);
    dom.countdownNumber.classList.remove('is-ticking');
    void dom.countdownNumber.offsetWidth;
    dom.countdownNumber.classList.add('is-ticking');
    audio.tick(isGo);
  }

  function beginRunning() {
    if (state.phase !== 'countdown') return;
    setPhase('running');
    dom.countdown.hidden = true;
    dom.coach.hidden = true;
    state.coachShown = true;
    state.warningNextAt = state.clock;
    dom.brakeZone.disabled = false;
    dom.brakeZone.classList.remove('is-disabled');
    dom.brakeZone.classList.toggle('needs-hint', !currentInputHeld());
    state.flash = 0;
    audio.tick(true);
  }

  /* ----------------------------------------------------------
     Lifecycle
     ---------------------------------------------------------- */

  function clearAttemptTimers() {
    clearTimeout(introHideTimer);
    clearTimeout(resultHideTimer);
  }

  function resetAttempt() {
    clearInput();
    state.clock = 0;
    state.phaseStart = 0;
    state.v = V0;
    state.gap = CFG.distance;
    state.travel = 0;
    state.force = 0;
    state.holdTime = 0;
    state.regen = 0;
    state.drag = 0;
    state.maxForce = 0;
    state.maxRegen = 0;
    state.snapForce = 0;
    state.snapped = false;
    state.countdownStage = 0;
    state.countdownStart = 0;
    state.coachShown = false;
    state.warningNextAt = 0;
    state.wheelAngle = 0;
    state.pedalDepress = 0;
    state.shake = 0;
    state.flash = 0;
    state.dustTimer = 0;
    state.crashAt = 0;
    state.resultAt = 0;
    state.resultShown = false;
    state.exploded = false;
    state.explosionAt = 0;
    state.impactKph = 0;
    state.outcome = null;
    state.crashReason = null;
    state.stopGap = 0;
    state.accumulator = 0;

    dom.snapBanner.hidden = true;
    dom.coach.hidden = true;
    dom.countdown.hidden = false;
    dom.countdownKicker.textContent = 'SYSTEM READY';
    dom.countdownNumber.textContent = '3';
    dom.countdownNumber.className = 'countdown-number';
    dom.countdownHint.textContent = '准备制动';
    dom.brakeZone.disabled = false;
    dom.brakeZone.classList.remove('is-disabled');
    dom.brakeZone.classList.remove('is-held');
    dom.brakeZone.classList.remove('needs-hint');
    dom.brakeZone.setAttribute('aria-pressed', 'false');
    dom.resultOverlay.classList.remove('is-visible');
    dom.resultOverlay.hidden = true;
    dom.assistCluster.classList.remove('is-assisting');
    BrakeWorld.resetEffects();
    BrakeWorld.resize();
    paintEndingChips(dom.resultEndings);
    updateUI(0.016);
  }

  function startCountdown() {
    state.paused = false;
    if (!dom.pauseOverlay.hidden) hidePauseImmediately();
    resetAttempt();
    setPhase('countdown');
    state.countdownStart = state.clock;
    dom.countdown.hidden = false;
    dom.countdown.style.animation = 'none';
    void dom.countdown.offsetWidth;
    dom.countdown.style.animation = '';
    audio.init();
    audio.tick(false);
    updateUI(0.016);
  }

  function startFromIntro() {
    if (state.phase !== 'intro') return;
    document.activeElement?.blur?.();
    audio.init();
    audio.ui();
    dom.introOverlay.classList.add('is-hidden');
    clearTimeout(introHideTimer);
    introHideTimer = window.setTimeout(() => {
      dom.introOverlay.hidden = true;
    }, 380);
    startCountdown();
  }

  function retryFromResult() {
    if (state.phase !== 'ended' && state.phase !== 'crash' && state.phase !== 'stopped') return;
    audio.ui();
    hideResult();
    startCountdown();
  }

  function goHome() {
    clearAttemptTimers();
    clearInput();
    hideResult();
    setPhase('intro');
    state.v = V0;
    state.gap = CFG.distance;
    state.travel = 0;
    state.force = 0;
    state.holdTime = 0;
    state.regen = 0;
    state.snapped = false;
    state.outcome = null;
    state.exploded = false;
    state.resultShown = false;
    state.pedalDepress = 0;
    state.paused = false;
    BrakeWorld.resetEffects();
    dom.countdown.hidden = true;
    dom.snapBanner.hidden = true;
    dom.coach.hidden = true;
    dom.brakeZone.disabled = false;
    dom.brakeZone.classList.remove('is-disabled', 'is-held', 'needs-hint');
    dom.introOverlay.hidden = false;
    requestAnimationFrame(() => {
      dom.introOverlay.classList.remove('is-hidden');
      dom.startButton.focus({ preventScroll: true });
    });
    updateUI(0.016);
    audio.ui();
  }

  function beginAttemptFromResult() {
    retryFromResult();
  }

  dom.startButton.addEventListener('click', startFromIntro);
  dom.retryButton.addEventListener('click', beginAttemptFromResult);
  dom.homeButton.addEventListener('click', goHome);

  let pauseHideTimer = 0;

  function canOpenPause() {
    return !state.paused
      && dom.introOverlay.hidden
      && !dom.resultOverlay.classList.contains('is-visible')
      && ['countdown', 'running', 'crash', 'stopped'].includes(state.phase);
  }

  function openPause() {
    if (!canOpenPause()) return;
    state.paused = true;
    state.accumulator = 0;
    clearInput();
    updateUI(0.016);
    paintVehicleSelection();
    clearTimeout(pauseHideTimer);
    dom.pauseOverlay.hidden = false;
    dom.menuButton.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      dom.pauseOverlay.classList.add('is-visible');
      dom.pauseFrame.focus({ preventScroll: true });
    });
    audio.init();
    audio.ui();
  }

  function closePause(options = {}) {
    if (!state.paused && dom.pauseOverlay.hidden) return;
    const { focus = true } = options;
    state.paused = false;
    dom.menuButton.setAttribute('aria-expanded', 'false');
    dom.pauseOverlay.classList.remove('is-visible');
    clearTimeout(pauseHideTimer);
    pauseHideTimer = window.setTimeout(() => {
      if (!dom.pauseOverlay.classList.contains('is-visible')) dom.pauseOverlay.hidden = true;
    }, 190);
    if (focus) dom.menuButton.focus({ preventScroll: true });
    audio.ui();
  }

  function hidePauseImmediately() {
    clearTimeout(pauseHideTimer);
    state.paused = false;
    dom.menuButton.setAttribute('aria-expanded', 'false');
    dom.pauseOverlay.classList.remove('is-visible');
    dom.pauseOverlay.hidden = true;
  }

  function pauseToHome() {
    if (!state.paused) return;
    hidePauseImmediately();
    clearInput();
    goHome();
  }

  function pauseRestart() {
    if (!state.paused) return;
    hidePauseImmediately();
    startCountdown();
  }

  dom.menuButton.addEventListener('click', openPause);
  dom.pauseClose.addEventListener('click', () => closePause());
  dom.pauseHome.addEventListener('click', pauseToHome);
  dom.pauseRestart.addEventListener('click', pauseRestart);
  dom.pauseOverlay.addEventListener('click', (event) => {
    if (event.target === dom.pauseOverlay) closePause();
  });

  function hideResult() {
    dom.resultOverlay.classList.remove('is-visible');
    dom.resultFrame.classList.remove('is-visible');
    clearTimeout(resultHideTimer);
    resultHideTimer = window.setTimeout(() => {
      if (!dom.resultOverlay.classList.contains('is-visible')) dom.resultOverlay.hidden = true;
    }, 240);
  }

  /* ----------------------------------------------------------
     Crash / result
     ---------------------------------------------------------- */

  function updateCrash() {
    if (state.phase !== 'crash') return;
    const age = state.clock - state.crashAt;
    if (state.outcome === 'burn' && !state.exploded && age >= 0.9) {
      state.exploded = true;
      state.explosionAt = state.clock;
      state.shake = Math.max(state.shake, 28);
      state.flash = 0.9;
      audio.explosion();
      BrakeWorld.emitCrash(state);
      BrakeWorld.emitExplosion();
      flashScreen('rgba(250, 245, 235, 0.92)', 480);
      vibrate([120, 30, 220]);
      state.resultAt = Math.max(state.resultAt, state.clock + 1.25);
    }
    if (state.outcome === 'burn' && !state.exploded && age > 0.15 && age < 0.9) {
      state.dustTimer -= 1 / 60;
      if (state.dustTimer <= 0) {
        state.dustTimer = 0.11;
        // Flame particles before the explosion.
        for (let i = 0; i < 3; i += 1) {
          BrakeWorld.emitCrash({ ...state, outcome: 'burn' });
        }
      }
    }
    if (!state.resultShown && state.clock >= state.resultAt) {
      showResult();
    }
  }

  function showResult() {
    if (state.resultShown) return;
    state.resultShown = true;
    if (!state.outcome) return;
    setPhase('ended');
    clearInput();
    dom.brakeZone.disabled = true;
    dom.brakeZone.classList.add('is-disabled');
    unlockEnding(state.outcome);
    paintEndingChips(dom.resultEndings);
    paintEndingChips(dom.introEndings);
    dom.resultEndingCount.textContent = `${unlocked.size} / ${endingIds.length}`;

    const meta = endingMeta[state.outcome];
    dom.resultFrame.classList.remove('is-win', 'is-lucky', 'is-fail', 'is-visible');
    dom.resultFrame.classList.add(meta.frameClass);
    dom.resultKicker.textContent = meta.kicker;
    dom.resultCode.textContent = meta.code;
    dom.resultTitle.textContent = meta.title;
    dom.resultSub.textContent = meta.sub;
    dom.resultStamp.textContent = meta.stamp;
    dom.resultStory.textContent = resultStory();
    dom.resultStats.innerHTML = resultStats();
    $$('.ending-chip', dom.resultEndings).forEach((chip) => {
      chip.classList.toggle('is-current', chip.dataset.ending === state.outcome);
    });
    setupResultMeter();
    dom.resultOverlay.hidden = false;
    requestAnimationFrame(() => {
      dom.resultOverlay.classList.add('is-visible');
      dom.resultFrame.classList.add('is-visible');
      requestAnimationFrame(() => {
        dom.meterFill.style.width = meterTarget();
      });
    });
    dom.resultFrame.scrollTop = 0;
    window.setTimeout(() => {
      if (!dom.resultOverlay.hidden && state.phase === 'ended') {
        dom.resultFrame.focus({ preventScroll: true });
      }
    }, 100);
  }

  const endingMeta = {
    perfect: {
      code: 'ENDING 01 / 03',
      kicker: 'TEST PASSED / 结局解锁',
      title: '完美停车',
      sub: 'ZERO BEFORE THE LIGHT',
      stamp: 'PASS',
      frameClass: 'is-win',
    },
    lucky: {
      code: 'ENDING 02 / 03',
      kicker: 'ENDING UNLOCKED / 结局解锁',
      title: '侥幸逃生',
      sub: 'DAMAGED, BUT ALIVE',
      stamp: 'ALIVE',
      frameClass: 'is-lucky',
    },
    burn: {
      code: 'ENDING 03 / 03',
      kicker: 'TEST FAILED / 事故结局',
      title: '烈焰终局',
      sub: 'NO SECOND CHANCE',
      stamp: 'FAIL',
      frameClass: 'is-fail',
    },
  };

  function resultStory() {
    const vehicle = vehicleMeta[state.vehicle]?.name || '测试车';
    if (state.outcome === 'perfect') {
      return `电制动与液压制动协同工作，${vehicle} 在路灯前停稳。液压回路保持完整，本次 500 米紧急制动测试通过。`;
    }
    if (state.outcome === 'lucky') {
      return `${vehicle} 撞上灯柱，但车体结构与安全系统保住了乘员舱。撞击速度 ${state.impactKph.toFixed(1)} km/h，低于 34 km/h 生死线，全员存活。`;
    }
    if (state.crashReason === 'snapped') {
      return `液压制动力突破 1400 N，刹车回路断裂，E‑REGEN 被强制切断。${vehicle} 以 ${state.impactKph.toFixed(1)} km/h 撞上灯柱，车头起火并发生爆炸。`;
    }
    return `撞击速度达到 ${state.impactKph.toFixed(1)} km/h，越过 34 km/h 生死线。车头瞬间起火，随后发生爆炸，本次测试失败。`;
  }

  function statHtml(label, value, unit = '') {
    return `<div class="result-stat"><span>${label}</span><b>${value}${unit ? `<em>${unit}</em>` : ''}</b></div>`;
  }

  function resultStats() {
    const maxForce = Math.round(state.maxForce || state.force || 0);
    if (state.outcome === 'perfect') {
      return [
        statHtml('灯前停车', Math.max(0, state.gap).toFixed(1), 'm'),
        statHtml('峰值液压', String(maxForce), 'N'),
        statHtml('峰值 E‑REGEN', String(Math.round(state.maxRegen || 0)), 'N'),
      ].join('');
    }
    if (state.outcome === 'lucky') {
      return [
        statHtml('撞击速度', state.impactKph.toFixed(1), 'km/h'),
        statHtml('峰值液压', String(maxForce), 'N'),
        statHtml('人员状态', '全员存活'),
      ].join('');
    }
    return [
      statHtml('撞击速度', state.impactKph.toFixed(1), 'km/h'),
      statHtml('峰值液压', String(maxForce), 'N'),
      statHtml('事故原因', state.crashReason === 'snapped' ? '刹车断裂' : '超速撞击'),
    ].join('');
  }

  function setupResultMeter() {
    dom.meterLimit.style.opacity = '0';
    dom.meterFill.style.width = '0%';
    dom.meterFill.style.background = '';
    dom.meterScaleMid.hidden = true;
    dom.meterScaleMid.style.left = '';
    dom.meterScaleMid.classList.remove('is-limit');
    if (state.outcome === 'perfect') {
      dom.meterLabel.textContent = '停车位置 / 500 m';
      dom.meterValue.textContent = `灯前 ${Math.max(0, state.gap).toFixed(1)} m`;
      dom.meterScaleStart.textContent = '起点';
      dom.meterScaleEnd.textContent = '路灯 · 500 m';
      dom.meterLimit.style.left = '100%';
      dom.meterLimit.style.opacity = '0.35';
      dom.meterFill.style.background = 'var(--green)';
    } else if (state.crashReason === 'snapped') {
      dom.meterLabel.textContent = '液压压力 / 断点 1400 N';
      dom.meterValue.textContent = `${Math.round(state.snapForce)} N · 已断裂`;
      dom.meterScaleStart.textContent = '0';
      dom.meterScaleEnd.textContent = '';
      dom.meterLimit.style.left = '93.333%';
      dom.meterLimit.style.opacity = '1';
      dom.meterScaleMid.textContent = '1400 N 断点';
      dom.meterScaleMid.style.left = '93.333%';
      dom.meterScaleMid.classList.add('is-limit');
      dom.meterScaleMid.hidden = false;
      dom.meterFill.style.background = 'var(--orange)';
    } else {
      dom.meterLabel.textContent = '撞击速度 / 生死线 34 km/h';
      dom.meterValue.textContent = `${state.impactKph.toFixed(1)} km/h`;
      dom.meterScaleStart.textContent = '0';
      dom.meterScaleEnd.textContent = '120+ km/h';
      dom.meterLimit.style.left = '28.333%';
      dom.meterLimit.style.opacity = '1';
      dom.meterScaleMid.textContent = '34 生死线';
      dom.meterScaleMid.style.left = '28.333%';
      dom.meterScaleMid.hidden = false;
      dom.meterFill.style.background = state.outcome === 'lucky' ? 'var(--amber)' : 'var(--orange)';
    }
  }

  function meterTarget() {
    if (state.outcome === 'perfect') {
      return `${clamp(state.travel / CFG.distance, 0, 1) * 100}%`;
    }
    if (state.crashReason === 'snapped') {
      return `${clamp(state.snapForce / CFG.gaugeMax, 0, 1) * 100}%`;
    }
    return `${clamp(state.impactKph / 120, 0, 1) * 100}%`;
  }

  /* ----------------------------------------------------------
     Input
     ---------------------------------------------------------- */

  function syncHeldVisual() {
    if (!canUsePedal()) return;
    const held = currentInputHeld();
    dom.brakeZone.classList.toggle('is-held', held);
    dom.brakeZone.setAttribute('aria-pressed', held ? 'true' : 'false');
    if (held) hideCoach();
  }

  dom.brakeZone.addEventListener('pointerdown', (event) => {
    if (!canUsePedal()) return;
    event.preventDefault();
    try {
      dom.brakeZone.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is a progressive enhancement */
    }
    if (event.pointerId !== undefined) state.activePointers.add(event.pointerId);
    state.pointerHeld = true;
    dom.brakeZone.classList.remove('needs-hint');
    hideCoach();
    syncHeldVisual();
    audio.init();
    if (state.force < 24) audio.pedal();
  });

  window.addEventListener('pointerup', (event) => {
    if (event.pointerId !== undefined) state.activePointers.delete(event.pointerId);
    if (state.activePointers.size === 0) state.pointerHeld = false;
    syncHeldVisual();
  });

  window.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== undefined) state.activePointers.delete(event.pointerId);
    if (state.activePointers.size === 0) state.pointerHeld = false;
    syncHeldVisual();
  });

  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' && event.code !== 'ArrowDown') return;
    if (event.repeat) {
      if (state.phase === 'running') event.preventDefault();
      return;
    }
    if (!canUsePedal()) return;
    event.preventDefault();
    state.keyHeld = true;
    dom.brakeZone.classList.remove('needs-hint');
    hideCoach();
    syncHeldVisual();
    audio.init();
    if (state.force < 24) audio.pedal();
  });

  document.addEventListener('keyup', (event) => {
    if (event.code !== 'Space' && event.code !== 'ArrowDown') return;
    if (state.phase === 'running') event.preventDefault();
    state.keyHeld = false;
    syncHeldVisual();
  });

  dom.brakeZone.addEventListener('contextmenu', (event) => event.preventDefault());
  dom.brakeZone.addEventListener('click', (event) => event.preventDefault());

  window.addEventListener('blur', () => {
    state.activePointers.clear();
    state.pointerHeld = false;
    state.keyHeld = false;
    syncHeldVisual();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInput();
      audioCtx?.suspend?.().catch?.(() => {});
    } else if (soundOn && audioCtx?.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!dom.pauseOverlay.hidden) {
      event.preventDefault();
      closePause();
      return;
    }
    if (!dom.resultOverlay.hidden) {
      event.preventDefault();
      goHome();
      return;
    }
    if (canOpenPause()) {
      event.preventDefault();
      openPause();
    }
  });

  /* ----------------------------------------------------------
     Visual effects helpers
     ---------------------------------------------------------- */

  function flashScreen(color, duration = 450) {
    dom.screenFlash.style.background = color;
    dom.screenFlash.classList.remove('is-active');
    dom.screenFlash.style.animationDuration = `${duration}ms`;
    void dom.screenFlash.offsetWidth;
    dom.screenFlash.classList.add('is-active');
  }

  function vibrate(pattern) {
    if (reducedMotion) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* ignore unsupported browsers */
    }
  }

  function updateEffects(dt) {
    state.time += dt;
    if (state.shake > 0) {
      state.shake = Math.max(0, state.shake - dt * (18 + state.shake * 2.3));
    }
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 2.2);
    if (state.phase === 'running') {
      if (state.v > 2 && state.force > 420) {
        state.dustTimer -= dt;
        if (state.dustTimer <= 0) {
          state.dustTimer = state.force > 1000 ? 0.075 : 0.13;
          BrakeWorld.emitCarDust(state);
        }
      }
      snapWarningTick();
    }
    BrakeWorld.updateEffects(state, dt);
  }

  /* ----------------------------------------------------------
     Main loop
     ---------------------------------------------------------- */

  let last = performance.now();
  let raf = 0;

  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;

    if (!state.paused) {
      state.clock += dt;

      if (state.phase === 'countdown') {
        updateCountdown();
      } else if (state.phase === 'running') {
        state.accumulator += dt;
        let steps = 0;
        while (state.phase === 'running' && state.accumulator >= CFG.fixedStep && steps < 8) {
          stepPhysics(CFG.fixedStep);
          state.accumulator -= CFG.fixedStep;
          steps += 1;
        }
        if (steps >= 8) state.accumulator = 0;
      } else if (state.phase === 'crash') {
        updateCrash();
      } else if (state.phase === 'stopped') {
        if (!state.resultShown && state.clock >= state.resultAt) showResult();
      }

      updateEffects(dt);
      updateUI(dt);
    }

    BrakeWorld.render({
      ...state,
      exploded: state.exploded,
      time: state.time,
      pedalDepress: state.pedalDepress,
      held: currentInputHeld(),
    });
    BrakeWorld.renderPedal({
      pedalDepress: state.pedalDepress,
      snapped: state.snapped,
      held: currentInputHeld(),
      phase: state.phase,
    });
    raf = requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------
     Boot
     ---------------------------------------------------------- */

  function boot() {
    buildSpeedDial();
    paintEndingChips(dom.introEndings);
    paintEndingChips(dom.resultEndings);
    paintVehicleSelection();
    updateSoundUI();
    BrakeWorld.bind(dom.scene, dom.pedalScene);
    state.introSkipped = false;
    dom.countdown.hidden = true;
    updateUI(0.016);
    BrakeWorld.render({
      ...state,
      time: 0,
      pedalDepress: 0,
      held: false,
    });
    requestAnimationFrame(() => {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    });
  }

  boot();
})();
