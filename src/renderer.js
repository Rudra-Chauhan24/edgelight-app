(function () {
  'use strict';

  // DOM Elements
  const canvas = document.getElementById('light');
  const ctx = canvas.getContext('2d');
  const bar = document.getElementById('bar');
  const hoverZone = document.getElementById('hover-zone');
  const status = document.getElementById('status');
  const power = document.getElementById('power');
  const brightnessInput = document.getElementById('brightness');
  const brightnessVal = document.getElementById('brightnessVal');
  const tempInput = document.getElementById('temp');
  const tempVal = document.getElementById('tempVal');
  const thicknessInput = document.getElementById('thickness');
  const thicknessVal = document.getElementById('thicknessVal');
  const holeSizeInput = document.getElementById('holeSize');
  const holeSizeVal = document.getElementById('holeSizeVal');
  const avoidSwitch = document.getElementById('avoidSwitch');
  const avoidLabel = document.getElementById('avoidLabel');
  const avoidMouseWrap = document.getElementById('avoidMouseWrap');
  const autoSwitch = document.getElementById('autoSwitch');
  const autoLabel = document.getElementById('autoLabel');
  const autoSwitchWrap = document.getElementById('autoSwitchWrap');
  const thresholdInput = document.getElementById('threshold');
  const thresholdVal = document.getElementById('thresholdVal');
  const thresholdWrap = document.getElementById('thresholdWrap');
  const liveLux = document.getElementById('liveLux');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const dismissBtn = document.getElementById('dismissBtn');
  const privacyNote = document.getElementById('privacy-note');
  const licenseBadge = document.getElementById('license-badge');
  const licenseModal = document.getElementById('license-modal');
  const wizardModal = document.getElementById('setup-wizard-modal');
  const closeLicenseBtn = document.getElementById('closeLicenseBtn');
  const copyHwidBtn = document.getElementById('copyHwidBtn');
  const hwidDisplay = document.getElementById('hwidDisplay');
  const modalStatusBadge = document.getElementById('modalStatusBadge');
  const licenseDescription = document.getElementById('licenseDescription');

  // License State
  let licenseState = {
    isAuthorized: true,
    status: 'trial',
    hwid: '',
    trialRemainingHours: 72,
    trialRemainingDays: 3,
    message: ''
  };

  // ── APPLICATION STATE ──────────────────────────────────────────────
  // Default values strictly synchronized with index.html UI controls:
  // Brightness: 100%, Temp: 4500K (0.50), Thickness: 96px, Hole: 100px
  const state = {
    on:            true,
    brightness:    1.0,
    temp:          0.50,
    thickness:     96,
    holeRadius:    100,
    margin:        3,
    avoidMouse:    true,
    mouseX:        -9999,
    mouseY:        -9999,
    autoThreshold: 70
  };

  // ── Automatic Website/App Webcam Detection State (MacBook Style) ──
  let autoWebcamEnabled = true;
  let wasTurnedOnByWebcam = false;
  let manualTurnedOffWhileWebcamActive = false;
  let currentWebcamInUse = false;

  // Smoothly interpolated render values (exponential damping)
  const renderState = {
    brightness: 1.0,
    temp:       0.50,
    thickness:  96,
    holeRadius: 100,
    thickScale: 0.0
  };
  window.__renderState = renderState;
  window.__state = state;

  // ── macOS-Style Fluid Cursor Hole State & Spring Physics ──────────
  const mouseState = {
    targetX: -9999,
    targetY: -9999,
    currentX: -9999,
    currentY: -9999,
    targetProximity: 0,
    currentProximity: 0
  };

  // Apple standard ease curve: cubic-bezier(0.4, 0.0, 0.2, 1) solver
  function bezierEase(p1x, p1y, p2x, p2y) {
    return function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let x = t;
      for (let i = 0; i < 6; i++) {
        const currentX = 3 * (1 - x) * (1 - x) * x * p1x + 3 * (1 - x) * x * x * p2x + x * x * x;
        const dx = 3 * (1 - x) * (1 - x) * p1x + 6 * (1 - x) * x * (p2x - p1x) + 3 * x * x * (1 - p2x);
        if (Math.abs(dx) < 1e-6) break;
        x = Math.max(0, Math.min(1, x - (currentX - t) / dx));
      }
      return 3 * (1 - x) * (1 - x) * x * p1y + 3 * (1 - x) * x * x * p2y + x * x * x;
    };
  }

  // Apple standard ease: cubic-bezier(0.4, 0.0, 0.2, 1)
  const easeStandard = bezierEase(0.4, 0.0, 0.2, 1);

  // Apple Edge Light bloom-in ease: very slow start, smooth acceleration.
  // Matches the organic feel where the light "grows" into the frame
  // rather than snapping on — cubic-bezier(0.0, 0.0, 0.2, 1) (ease-in-out slow start)
  const easeBloom = bezierEase(0.0, 0.0, 0.15, 1.0);

  // ── ANIMATION SYSTEM ── thickScale 0↔1 with smooth ease-in and ease-out curves (3s duration)
  // Turn ON & Turn OFF: cubic-bezier(0.42, 0.0, 0.58, 1.0) ease-in and ease-out transition curve
  // Symmetrical, luxurious ease-in and ease-out transition that gently accelerates and decelerates over 3000ms.
  const ANIM_ON_MS  = 3000;  // 3.0s ease-in and ease-out bloom-in duration
  const ANIM_OFF_MS = 3000;  // 3.0s ease-in and ease-out bloom-out duration
  // Ease-in and ease-out transition: cubic-bezier(0.42, 0.0, 0.58, 1.0)
  const easeInOut    = bezierEase(0.42, 0.0, 0.58, 1.0);
  const easeBloomIn  = easeInOut;
  const easeBloomOut = easeInOut;

  let thickScaleTarget = 1.0;   // where we are heading (1=on, 0=off)
  let thickScaleFrom   = 0.0;   // value when the last transition started
  let thickScaleTime   = 0;     // performance.now() at last transition start
  let thickScaleDir    = 1;     // +1 = turning on, -1 = turning off

  let animFrameId   = null;
  let lastFrameTime = performance.now();

  let dpr = window.devicePixelRatio || 1;

  // Thorough canvas wipe that clears the full hardware buffer irrespective of transforms or filters
  function clearCanvas() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  // ── AUTO SCREEN SIZE DETECTION & ADJUSTMENT ───────────────────────
  // Automatically detects PC screen dimensions on installation/startup
  // and proportionally calculates optimal ring thickness.
  // Standard 1080p yields exactly 96px. Smaller laptop screens (768p/720p)
  // adjust to ~64-68px so the ring never overwhelms the display.
  // High-res displays (1440p/4K) scale appropriately.
  function calculateOptimalThickness(screenH) {
    const h = screenH || window.innerHeight || window.screen?.height || 1080;
    const optimal = Math.round((h * 0.0888) / 2) * 2;
    const min = Number(thicknessInput?.min) || 20;
    const max = Number(thicknessInput?.max) || 180;
    return Math.max(min, Math.min(max, optimal));
  }

  function autoAdjustToScreen(notify = false) {
    const screenH = window.innerHeight || window.screen?.height || 1080;
    const userCustom = localStorage.getItem('edgelight_custom_thickness');

    let targetThickness;
    if (userCustom !== null) {
      targetThickness = Number(userCustom);
    } else {
      targetThickness = calculateOptimalThickness(screenH);
    }

    const min = Number(thicknessInput?.min) || 20;
    const max = Number(thicknessInput?.max) || 180;
    const clamped = Math.min(max, Math.max(min, Math.round(targetThickness)));

    state.thickness = clamped;
    renderState.thickness = clamped;
    if (thicknessInput) thicknessInput.value = clamped;
    if (thicknessVal) thicknessVal.textContent = `${clamped}px`;

    if (notify) {
      showStatus(`🖥️ Screen detected (${Math.round(window.innerWidth)}×${Math.round(screenH)}) — Ring: ${clamped}px`, 2200);
    }
    requestRender();
  }
  window.__calculateOptimalThickness = calculateOptimalThickness;
  window.__autoAdjustToScreen = autoAdjustToScreen;

  // Resize canvas to match screen resolution
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = Math.max(100, window.innerWidth || 1920);
    const h = Math.max(100, window.innerHeight || 1080);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Auto-adjust thickness to detected PC screen size if user hasn't set custom manual override
    if (localStorage.getItem('edgelight_custom_thickness') === null) {
      autoAdjustToScreen(false);
    }

    if (!state.on && renderState.thickScale <= 0.002) {
      clearCanvas();
    } else {
      drawFrame();
    }
  }

  // ── COLOR TEMPERATURE ──────────────────────────────────────────────
  // Studio lighting: 0 = 3744K warm white · 0.50 = 5000K neutral white · 1 = 6500K cool daylight.
  function tempToRGB(t) {
    let r, g, b;
    if (t <= 0.50) {
      const f = t / 0.50;
      r = 255;
      g = Math.round(210 + (255 - 210) * f);   // 210 → 255
      b = Math.round(135 + (252 - 135) * f);   // 135 → 252
    } else {
      const f = (t - 0.50) / 0.50;
      r = Math.round(255 + (220 - 255) * f);   // 255 → 220
      g = Math.round(255 + (235 - 255) * f);   // 255 → 235
      b = Math.round(252 + (255 - 252) * f);   // 252 → 255
    }
    return { r, g, b };
  }

  // Superellipse ("squircle") path — continuous-curvature corners matching Apple.
  //
  // Apple's Edge Light ring uses a continuous-curvature superellipse with n ≈ 2.7.
  // This produces smooth C2 continuous curvature that seamlessly blends into the
  // straight screen edges without the boxy bulging produced by higher exponents (n=4.5)
  // or the abrupt tangent discontinuity of circular border-radius arcs.
  //
  // Parametrization for each corner quadrant:
  //   x_offset = sign(cos t) · |cos t|^(2/n) · r
  //   y_offset = sign(sin t) · |sin t|^(2/n) · r
  const SQUIRCLE_N   = 2.7;          // Apple Edge Light continuous-curvature exponent
  const SQUIRCLE_INV = 2 / SQUIRCLE_N; // cached: 2/n
  const SQUIRCLE_STEPS = 48;         // samples per quadrant for ultra-smooth curves

  function squirclePath(path, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    if (r <= 0 || w <= 0 || h <= 0) {
      if (w > 0 && h > 0) path.rect(x, y, w, h);
      return;
    }

    // Each row: [corner-centre-x, corner-centre-y, t-start, t-end]
    // Corners are visited in winding order: top-right → bottom-right →
    // bottom-left → top-left so the closed path fills correctly.
    const corners = [
      [x + w - r, y + r,     -Math.PI / 2,  0             ],  // top-right
      [x + w - r, y + h - r,  0,             Math.PI / 2  ],  // bottom-right
      [x + r,     y + h - r,  Math.PI / 2,   Math.PI      ],  // bottom-left
      [x + r,     y + r,      Math.PI,       3 * Math.PI / 2], // top-left
    ];

    let first = true;
    for (const [cx, cy, t0, t1] of corners) {
      for (let i = 0; i <= SQUIRCLE_STEPS; i++) {
        const t    = t0 + (t1 - t0) * i / SQUIRCLE_STEPS;
        const cosT = Math.cos(t);
        const sinT = Math.sin(t);
        // |cos t|^(2/n) · sign(cos t)  — raises to fractional power, preserves sign
        const px = cx + (cosT >= 0 ? 1 : -1) * Math.pow(Math.abs(cosT), SQUIRCLE_INV) * r;
        const py = cy + (sinT >= 0 ? 1 : -1) * Math.pow(Math.abs(sinT), SQUIRCLE_INV) * r;
        if (first) { path.moveTo(px, py); first = false; }
        else        path.lineTo(px, py);
      }
    }
    path.closePath();
  }

  // ── DRAW FRAME — Apple Edge Light faithful recreation ──────────────
  //
  // Apple behavior (from official docs + visual analysis):
  //  • Band sits flush at screen edges, ~3-6% of screen height wide
  //  • Brightness slider → modulates BAND WIDTH (wider = more light output)
  //  • Bright luminous white CORE with soft gradient feathering on both
  //    inner edge (toward content) and outer edge (toward bezel)
  //  • Default color: pure daylight white ~5500K
  //  • Cursor recede: smooth notch ONLY when cursor is near/on the band
  //    — invisible when cursor is in screen interior
  //
  function drawFrame() {
    clearCanvas();

    // If light is turned off and animation settled, guarantee canvas is clear and exit immediately
    if (!state.on && renderState.thickScale <= 0.002) {
      return;
    }

    const ts = renderState.thickScale; // 0→1
    if (ts <= 0.002) return; // nothing to draw

    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const { r, g, b } = tempToRGB(renderState.temp);

    // ── BAND WIDTH driven strictly by user's thickness setting ─────────
    const sliderThick = renderState.thickness;
    const maxSafeThick = Math.max(30, Math.floor((Math.min(sw, sh) - 60) / 2));
    const baseThick = Math.min(sliderThick, maxSafeThick);
    const thick = Math.max(6, Math.round(baseThick));

    // Apple-style bloom: band smoothly expands on turn-on and organically retreats back
    // into the screen bezel on turn-off as thickScale (ts) interpolates between 0 and 1.
    const animThick = Math.max(0, thick * ts);
    if (animThick <= 0.5) return;

    // Pure ease-in and ease-out: alpha directly tracks thickScale (ts), which follows
    // the 3.0-second cubic-bezier(0.42, 0.0, 0.58, 1.0) curve for seamless symmetrical easing.
    const alpha = ts;
    // Master opacity modulates with brightness slider (opacity control rather than thickness):
    const masterOpacity = alpha * Math.max(0.05, Math.min(1.0, renderState.brightness));

    const margin  = state.margin;
    const outerX  = margin;
    const outerY  = margin;
    const outerW  = sw - margin * 2;
    const outerH  = sh - margin * 2;

    // Corner radius: ~21% of shorter dimension (calibrated to continuous squircle geometry)
    const outerR  = Math.min(
      Math.max(Math.round(Math.min(outerW, outerH) * 0.21), 16),
      Math.min(outerW, outerH) / 2
    );

    // Inner cutout — offset by animThick so the band grows from the outer edge inward.
    const innerX  = outerX + animThick;
    const innerY  = outerY + animThick;
    const innerW  = outerW - animThick * 2;
    const innerH  = outerH - animThick * 2;
    const innerR  = Math.max(2, outerR - animThick);
    if (innerW <= 0 || innerH <= 0) return;

    // ── LAYER A: OUTER SOFT SPILL (feathered toward bezel) ────────────
    {
      const spill   = new Path2D();
      const spillX  = outerX - 4;
      const spillY  = outerY - 4;
      const spillW  = outerW + 8;
      const spillH  = outerH + 8;
      const spillR  = outerR + 4;
      squirclePath(spill, spillX, spillY, spillW, spillH, spillR);
      squirclePath(spill, innerX, innerY, innerW, innerH, innerR);
      ctx.save();
      ctx.filter = 'blur(8px)';
      ctx.fillStyle = `rgba(${r},${g},${b},${masterOpacity * 0.26})`;
      ctx.fill(spill, 'evenodd');
      ctx.filter = 'none';
      ctx.restore();
    }

    // ── LAYER B: CORE BAND — golden/amber border when warm, daylight when cool ─
    const corePath = new Path2D();
    squirclePath(corePath, outerX, outerY, outerW, outerH, outerR);
    squirclePath(corePath, innerX, innerY, innerW, innerH, innerR);
    ctx.save();
    ctx.fillStyle = `rgba(${r},${g},${b},${masterOpacity * 0.92})`;
    ctx.fill(corePath, 'evenodd');
    ctx.restore();

    // ── LAYER C: INNER SOFT FEATHER (gradient falloff inward) ─────────
    {
      const featherDepth = Math.max(1, Math.round(animThick * 0.45));
      const fInX = innerX - featherDepth;
      const fInY = innerY - featherDepth;
      const fInW = innerW + featherDepth * 2;
      const fInH = innerH + featherDepth * 2;
      const fInR = Math.max(2, innerR - featherDepth);
      const featherPath = new Path2D();
      squirclePath(featherPath, fInX, fInY, fInW, fInH, fInR);
      squirclePath(featherPath, innerX, innerY, innerW, innerH, innerR);
      ctx.save();
      ctx.filter = `blur(${Math.max(1, Math.round(featherDepth * 0.6))}px)`;
      ctx.fillStyle = `rgba(${r},${g},${b},${masterOpacity * 0.55})`;
      ctx.fill(featherPath, 'evenodd');
      ctx.filter = 'none';
      ctx.restore();
    }

    // ── LAYER D: SOFTLY BLENDED LUMINOUS WHITE CENTER CORE ────────────
    // When in warm spectrum, center core radiates luminous white that melts
    // seamlessly into the golden border with ZERO hard demarcation lines.
    // Clipped to corePath so outer & inner ring boundaries stay 100% crisp.
    const warmFactor = renderState.temp <= 0.50 ? (0.50 - renderState.temp) / 0.50 : 0;
    if (warmFactor > 0.02 && animThick >= 12) {
      ctx.save();
      ctx.clip(corePath, 'evenodd');

      const midInset = animThick * 0.5;
      const midX = outerX + midInset;
      const midY = outerY + midInset;
      const midW = outerW - midInset * 2;
      const midH = outerH - midInset * 2;
      const midR = Math.max(2, outerR - midInset);

      if (midW > 0 && midH > 0) {
        const midPath = new Path2D();
        squirclePath(midPath, midX, midY, midW, midH, midR);

        // Pass 1: Broad ultra-soft diffusion glow (eliminates any line demarcation)
        ctx.save();
        ctx.lineWidth = Math.round(animThick * 0.60);
        ctx.filter = `blur(${Math.round(animThick * 0.42)}px)`;
        ctx.strokeStyle = `rgba(255, 255, 252, ${masterOpacity * 0.50 * warmFactor})`;
        ctx.stroke(midPath);
        ctx.restore();

        // Pass 2: Smooth center luminous core focus
        ctx.save();
        ctx.lineWidth = Math.round(animThick * 0.30);
        ctx.filter = `blur(${Math.round(animThick * 0.26)}px)`;
        ctx.strokeStyle = `rgba(255, 255, 252, ${masterOpacity * 0.65 * warmFactor})`;
        ctx.stroke(midPath);
        ctx.restore();
      }

      ctx.restore();
    }

    // ── macOS Fluid Cursor Hole (Apple Edge Light Recede Cove) ────────
    if (state.avoidMouse && state.on && mouseState.currentProximity > 0.01 && ts > 0.05 && mouseState.currentX > -1000) {
      const cx = mouseState.currentX;
      const cy = mouseState.currentY;
      const p = mouseState.currentProximity;

      const screenMin = Math.min(sw, sh);
      // High-accuracy responsive hole radius scaled to screen and ring thickness
      const dynamicHoleRadius = Math.round(Math.max(140, Math.min(240, animThick * 1.4 + screenMin * 0.10)));
      const hr = dynamicHoleRadius * ts;
      if (hr < 10) return;

      // Pinpoint accurate cursor visibility zone:
      // Expanded clear core guarantees the pointer, click target, and text are 100% visible
      const coreR = Math.min(hr * 0.52, Math.max(32, hr * 0.38));
      const coreRatio = Math.max(0.08, Math.min(0.65, coreR / hr));

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, hr);
      grad.addColorStop(0.0, `rgba(0,0,0,${p})`);
      grad.addColorStop(coreRatio, `rgba(0,0,0,${p})`);

      // 10 smoothstep points for ultra-smooth C1 continuous falloff
      const steps = 10;
      let lastStop = coreRatio;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const stopPos = coreRatio + t * (1 - coreRatio);
        const smoothT = t * t * (3 - 2 * t);
        const alpha = Math.max(0, (1 - smoothT) * p);
        const safeStop = Math.min(1.0, Math.max(lastStop, stopPos));
        lastStop = safeStop;
        grad.addColorStop(safeStop, `rgba(0,0,0,${alpha.toFixed(4)})`);
      }

      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.filter = 'none';
      ctx.beginPath();
      ctx.arc(cx, cy, hr, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }
  }


  // Render animation loop providing ~80-120ms smooth interpolation
  function requestRender() {
    if (!animFrameId) {
      lastFrameTime = performance.now();
      animFrameId = requestAnimationFrame(renderLoop);
    }
  }

  function renderLoop(now) {
    const rawDt = now - lastFrameTime;
    const dt = Math.max(1, Math.min(isNaN(rawDt) ? 16 : rawDt, 33));
    lastFrameTime = now;

    let needsNextFrame = false;

    // Smooth exponential damping over ~90ms (tau = 35ms gives responsive yet fluid glide)
    const damping = 1 - Math.exp(-dt / 35);

    const targetBrightness = state.brightness;
    const db = targetBrightness - renderState.brightness;
    if (Math.abs(db) > 0.002) {
      renderState.brightness += db * damping;
      needsNextFrame = true;
    } else {
      renderState.brightness = targetBrightness;
    }

    const targetTemp = state.temp;
    const dtTemp = targetTemp - renderState.temp;
    if (Math.abs(dtTemp) > 0.002) {
      renderState.temp += dtTemp * damping;
      needsNextFrame = true;
    } else {
      renderState.temp = targetTemp;
    }

    const targetThickness = state.thickness;
    const dThick = targetThickness - renderState.thickness;
    if (Math.abs(dThick) > 0.05) {
      renderState.thickness += dThick * damping;
      needsNextFrame = true;
    } else {
      renderState.thickness = targetThickness;
    }

    const targetHole = state.holeRadius;
    const dHole = targetHole - renderState.holeRadius;
    if (Math.abs(dHole) > 0.5) {
      renderState.holeRadius += dHole * damping;
      needsNextFrame = true;
    } else {
      renderState.holeRadius = targetHole;
    }

    // ── thickScale animation — bloom-in / bloom-out ──────────────────
    // This is the main on/off animation. It drives both the rendered band
    // thickness (animThick = thick * thickScale) and the glow opacity,
    // producing the "band grows from screen edge inward" bloom-on effect
    // and the "band retreats back to screen edge" bloom-off effect.
    if (renderState.thickScale !== thickScaleTarget) {
      const duration = thickScaleDir > 0 ? ANIM_ON_MS : ANIM_OFF_MS;
      const ease     = thickScaleDir > 0 ? easeBloomIn : easeBloomOut;
      const elapsed  = now - thickScaleTime;
      const progress = Math.min(1.0, elapsed / duration);
      const eased    = ease(progress);
      renderState.thickScale = thickScaleFrom + (thickScaleTarget - thickScaleFrom) * eased;

      if (progress < 1.0) {
        needsNextFrame = true;
      } else {
        renderState.thickScale = thickScaleTarget;
        if (thickScaleTarget === 0) {
          clearCanvas();
        }
      }

      if (thickScaleTarget === 0 && renderState.thickScale <= 0.005) {
        renderState.thickScale = 0.0;
        clearCanvas();
      }
    }

    // ── macOS-Style Fluid Cursor Hole Spring Interpolation ──────────
    let targetP = 0;
    if (mouseState.targetX > -1000 && state.avoidMouse && state.on && renderState.thickScale > 0.05) {
      if (mouseState.currentX < -1000) {
        mouseState.currentX = mouseState.targetX;
        mouseState.currentY = mouseState.targetY;
      } else {
        // High-precision adaptive tracking: snaps immediately on fast movement, silky glide on slow movement
        const dx = mouseState.targetX - mouseState.currentX;
        const dy = mouseState.targetY - mouseState.currentY;
        const dist = Math.hypot(dx, dy);
        const followTau = dist > 90 ? 6 : (dist > 30 ? 10 : 15);
        const mouseFollow = 1 - Math.exp(-dt / followTau);
        mouseState.currentX += dx * mouseFollow;
        mouseState.currentY += dy * mouseFollow;
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          needsNextFrame = true;
        }
      }

      // Proximity calculation: seamless entry and exit across all 4 edges and corners
      const sw = window.innerWidth;
      const sh = window.innerHeight;
      const animThick = Math.max(6, Math.round(renderState.thickness)) * renderState.thickScale;
      const margin = state.margin || 3;

      const outerW = sw - margin * 2;
      const outerH = sh - margin * 2;
      const outerR = Math.min(
        Math.max(Math.round(Math.min(outerW, outerH) * 0.21), 16),
        Math.min(outerW, outerH) / 2
      );
      const innerR = Math.max(2, outerR - animThick);
      const innerX = margin + animThick;
      const innerY = margin + animThick;
      const innerW = outerW - animThick * 2;
      const innerH = outerH - animThick * 2;

      // Use true target cursor coordinate for proximity to eliminate any approach latency
      const cx = mouseState.targetX;
      const cy = mouseState.targetY;

      // Compute signed penetration into the light band (positive = inside band, negative = inside screen center)
      let bandDepth = 0;
      const inLeftCorner = cx < innerX + innerR;
      const inRightCorner = cx > innerX + innerW - innerR;
      const inTopCorner = cy < innerY + innerR;
      const inBottomCorner = cy > innerY + innerH - innerR;

      if (inLeftCorner && inTopCorner) {
        const cornerCenterX = innerX + innerR;
        const cornerCenterY = innerY + innerR;
        bandDepth = Math.hypot(cx - cornerCenterX, cy - cornerCenterY) - innerR;
      } else if (inRightCorner && inTopCorner) {
        const cornerCenterX = innerX + innerW - innerR;
        const cornerCenterY = innerY + innerR;
        bandDepth = Math.hypot(cx - cornerCenterX, cy - cornerCenterY) - innerR;
      } else if (inLeftCorner && inBottomCorner) {
        const cornerCenterX = innerX + innerR;
        const cornerCenterY = innerY + innerH - innerR;
        bandDepth = Math.hypot(cx - cornerCenterX, cy - cornerCenterY) - innerR;
      } else if (inRightCorner && inBottomCorner) {
        const cornerCenterX = innerX + innerW - innerR;
        const cornerCenterY = innerY + innerH - innerR;
        bandDepth = Math.hypot(cx - cornerCenterX, cy - cornerCenterY) - innerR;
      } else {
        const depthLeft   = innerX - cx;
        const depthRight  = cx - (innerX + innerW);
        const depthTop    = innerY - cy;
        const depthBottom = cy - (innerY + innerH);
        bandDepth = Math.max(depthLeft, depthRight, depthTop, depthBottom);
      }

      // targetP: 1.0 everywhere inside the light band, smoothly dissolving as cursor retreats into screen center
      const approachZone = 110;
      targetP = Math.max(0, Math.min(1.0, (bandDepth + approachZone) / (approachZone - 15)));
    }

    mouseState.targetProximity = targetP;

    // Fast opening response (~16ms) and smooth dissolve-out (~42ms) for optimal cursor responsiveness
    if (mouseState.currentProximity !== targetP) {
      const pSpeed = targetP > mouseState.currentProximity ? 16 : 42;
      const pDamping = 1 - Math.exp(-dt / pSpeed);
      const dp = targetP - mouseState.currentProximity;
      if (Math.abs(dp) > 0.002) {
        mouseState.currentProximity += dp * pDamping;
        needsNextFrame = true;
      } else {
        mouseState.currentProximity = targetP;
      }
    }

    try {
      drawFrame();
    } catch (err) {
      console.error('Frame rendering error:', err);
      if (!state.on) {
        clearCanvas();
      }
    }

    if (needsNextFrame) {
      animFrameId = requestAnimationFrame(renderLoop);
    } else {
      animFrameId = null;
    }
  }

  // Power state control with tactile spring press & smooth clean fade
  function setOn(value) {
    if (state.on === value && thickScaleTarget === (value ? 1.0 : 0.0)) return;
    state.on = value;
    power.classList.toggle('active', value);
    power.setAttribute('aria-pressed', value ? 'true' : 'false');

    // Apple tactile press spring bounce
    power.classList.remove('pressed');
    void power.offsetWidth;
    power.classList.add('pressed');

    // Start thickScale bloom-in or clean fade-out from the current animated value
    thickScaleFrom   = renderState.thickScale;
    thickScaleTime   = performance.now();
    thickScaleTarget = value ? 1.0 : 0.0;
    thickScaleDir    = value ? 1 : -1;

    if (!value) {
      if (privacyNote) {
        privacyNote.classList.remove('visible');
      }
      mouseState.targetProximity = 0;
      mouseState.currentProximity = 0;
      if (renderState.thickScale <= 0.002) {
        renderState.thickScale = 0.0;
        clearCanvas();
      }
    }

    requestRender();

    if (window.edgeLightAPI?.notifyLightState) {
      window.edgeLightAPI.notifyLightState(value);
    }
  }

  power.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!licenseState.isAuthorized) {
      showLicenseModal();
      showStatus('🔒 License activation required', 2200);
      return;
    }
    if (stream) {
      stopAuto();
    }
    const nextState = !state.on;
    if (!nextState && currentWebcamInUse) {
      manualTurnedOffWhileWebcamActive = true;
    }
    wasTurnedOnByWebcam = false;
    setOn(nextState);
    power.blur();
    showStatus(state.on ? 'Edge Light On ✨' : 'Edge Light Off', 1800);
    if (!state.on && !isInteractingWithDock) {
      resetIdleTimer();
    }
  });
  power.addEventListener('animationend', () => {
    power.classList.remove('pressed');
  });

  // Slider inputs: update targets and smoothly interpolate in canvas
  brightnessInput?.addEventListener('input', () => {
    state.brightness = brightnessInput.value / 100;
    if (brightnessVal) brightnessVal.textContent = `${brightnessInput.value}%`;
    showStatus(`✨ Opacity: ${brightnessInput.value}%`, 1600);
    requestRender();
  });

  tempInput.addEventListener('input', () => {
    const v = Number(tempInput.value);
    state.temp = v / 100;
    // Kelvin readout: 0→3744K, 50→5000K, 100→6500K (linear piecewise)
    const kelvin = v <= 50
      ? Math.round(3744 + (5000 - 3744) * (v / 50))
      : Math.round(5000 + (6500 - 5000) * ((v - 50) / 50));
    if (tempVal) tempVal.textContent = `${kelvin}K`;
    showStatus(`🌡️ Temp: ${kelvin}K`, 1600);
    requestRender();
  });

  function setThickness(val) {
    const min = Number(thicknessInput.min) || 20;
    const max = Number(thicknessInput.max) || 180;
    const clamped = Math.min(max, Math.max(min, Math.round(val)));
    state.thickness = clamped;
    thicknessInput.value = clamped;
    thicknessVal.textContent = `${clamped}px`;
    showStatus(`📐 Thickness: ${clamped}px`, 1600);
    requestRender();
  }

  thicknessInput.addEventListener('input', () => {
    localStorage.setItem('edgelight_custom_thickness', thicknessInput.value);
    setThickness(Number(thicknessInput.value));
  });

  // Hole size slider (kept safe if element exists)
  holeSizeInput?.addEventListener('input', () => {
    state.holeRadius = Number(holeSizeInput.value);
    if (holeSizeVal) holeSizeVal.textContent = `${state.holeRadius}px`;
    requestRender();
  });

  // Avoid mouse toggle (permanently true by default, kept safe if element exists)
  function toggleAvoidMouse() {
    state.avoidMouse = !state.avoidMouse;
    avoidSwitch?.setAttribute('aria-checked', state.avoidMouse ? 'true' : 'false');
    requestRender();
  }

  avoidSwitch?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAvoidMouse();
  });
  avoidLabel?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAvoidMouse();
  });
  avoidMouseWrap?.addEventListener('click', (e) => {
    if (e.target !== avoidSwitch && !avoidSwitch?.contains(e.target) && e.target !== avoidLabel) {
      toggleAvoidMouse();
    }
  });

  // Calibration threshold
  thresholdInput?.addEventListener('input', () => {
    state.autoThreshold = Number(thresholdInput.value);
    if (thresholdVal) thresholdVal.textContent = thresholdInput.value;
    showStatus(`🎚️ Sensitivity: ${thresholdInput.value}`, 1500);
    if (stream && videoEl && videoEl.readyState >= 2) {
      sampleFromVideo();
    }
  });

  // Status feedback toast
  let statusHideTimer = null;
  function showStatus(msg, autoHideMs = 0) {
    status.textContent = msg;
    status.classList.add('visible');
    if (statusHideTimer) clearTimeout(statusHideTimer);
    if (autoHideMs > 0) {
      statusHideTimer = setTimeout(() => {
        status.classList.remove('visible');
      }, autoHideMs);
    }
  }

  function hideStatus() {
    if (statusHideTimer) clearTimeout(statusHideTimer);
    status.classList.remove('visible');
  }

  // Dock Auto-hide and Click-through IPC management
  let idleTimer = null;
  let isInteractingWithDock = false;
  let clickThroughState = true;

  function isAnyModalOpen() {
    const licModal = licenseModal || document.getElementById('license-modal');
    const wizModal = wizardModal || document.getElementById('setup-wizard-modal');
    return Boolean(
      (licModal && licModal.classList.contains('visible')) ||
      (wizModal && wizModal.classList.contains('visible'))
    );
  }

  function setClickThrough(enableClickThrough) {
    if (enableClickThrough && isAnyModalOpen()) {
      enableClickThrough = false;
    }
    if (clickThroughState === enableClickThrough) return;
    clickThroughState = enableClickThrough;
    if (window.edgeLightAPI?.setIgnoreMouseEvents) {
      if (enableClickThrough) {
        window.edgeLightAPI.setIgnoreMouseEvents(true, { forward: true });
      } else {
        window.edgeLightAPI.setIgnoreMouseEvents(false);
      }
    }
  }

  function showDock() {
    bar.classList.add('visible');
    hoverZone.classList.add('dock-open');
    hoverZone.style.pointerEvents = 'none';
    if (stream && state.on && privacyNote) {
      privacyNote.classList.add('visible');
    }
    // Only capture clicks if pointer is currently over the dock controls or a modal is open
    if (isInteractingWithDock || isPointerDown || isAnyModalOpen()) {
      setClickThrough(false);
    } else {
      setClickThrough(true);
    }
    resetIdleTimer();
    if (window.edgeLightAPI?.notifyControlsState) {
      window.edgeLightAPI.notifyControlsState(true);
    }
  }

  function scheduleHideDock() {
    if (isInteractingWithDock || bar.contains(document.activeElement) || isAnyModalOpen()) return;
    forceHideDock();
  }

  function forceHideDock() {
    clearTimeout(idleTimer);
    isInteractingWithDock = false;
    bar.classList.remove('visible');
    hoverZone.classList.remove('dock-open');
    hoverZone.style.pointerEvents = 'auto';
    if (privacyNote) {
      privacyNote.classList.remove('visible');
    }
    if (!isAnyModalOpen()) {
      setClickThrough(true);
    }
    if (window.edgeLightAPI?.notifyControlsState) {
      window.edgeLightAPI.notifyControlsState(false);
    }
  }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    const activeIsInput = document.activeElement &&
      (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    if (!isInteractingWithDock && !activeIsInput) {
      idleTimer = setTimeout(scheduleHideDock, 3000);
    }
  }

  // Dismiss button immediately sends control bar to background
  dismissBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    forceHideDock();
  });

  // Pointer down tracking: while dragging any slider or pressing any control,
  // ensure we do NOT drop click-through or abort the interaction if pointer drifts outside bar.
  let isPointerDown = false;

  bar.addEventListener('pointerdown', () => {
    isPointerDown = true;
    isInteractingWithDock = true;
    clearTimeout(idleTimer);
    setClickThrough(false);
  });

  window.addEventListener('pointerup', () => {
    isPointerDown = false;
    resetIdleTimer();
  });

  // Hover zone and Bar event handlers
  bar.addEventListener('mouseenter', () => {
    isInteractingWithDock = true;
    clearTimeout(idleTimer);
    setClickThrough(false);
  });

  bar.addEventListener('pointerenter', () => {
    isInteractingWithDock = true;
    clearTimeout(idleTimer);
    setClickThrough(false);
  });

  bar.addEventListener('mouseover', () => {
    isInteractingWithDock = true;
    clearTimeout(idleTimer);
    setClickThrough(false);
  });

  bar.addEventListener('mouseleave', () => {
    if (isPointerDown) return;
    isInteractingWithDock = false;
    if (!isAnyModalOpen()) {
      setClickThrough(true);
      resetIdleTimer();
    }
  });

  hoverZone.addEventListener('mouseenter', () => {
    showDock();
  });

  hoverZone.addEventListener('mousemove', () => {
    showDock();
  });

  bar.addEventListener('focusin', () => {
    showDock();
    setClickThrough(false);
  });

  bar.addEventListener('focusout', () => {
    if (isPointerDown) return;
    isInteractingWithDock = false;
    if (!isAnyModalOpen()) {
      setClickThrough(true);
      resetIdleTimer();
    }
  });

  window.addEventListener('mousemove', (e) => {
    state.mouseX = e.clientX;
    state.mouseY = e.clientY;
    mouseState.targetX = e.clientX;
    mouseState.targetY = e.clientY;
    if (state.avoidMouse && (state.on || renderState.thickScale > 0.001)) {
      requestRender();
    }

    // When modal (license or wizard) is visible, never pass clicks through to background
    if (isAnyModalOpen()) {
      clearTimeout(idleTimer);
      setClickThrough(false);
      return;
    }

    // Check if cursor is over control dock bounds with exact pixel bounds (zero margin)
    const isBarVisible = bar.classList.contains('visible');
    let isInsideBar = false;

    if (isBarVisible) {
      const barRect = bar.getBoundingClientRect();
      isInsideBar = (
        e.clientX >= barRect.left &&
        e.clientX <= barRect.right &&
        e.clientY >= barRect.top &&
        e.clientY <= barRect.bottom
      );
    }

    if (isInsideBar || isPointerDown) {
      isInteractingWithDock = true;
      clearTimeout(idleTimer);
      setClickThrough(false);
    } else {
      isInteractingWithDock = false;
      // Allow user to click backward apps, desktop, or windows outside the floating dock
      // Exactly from the physical bar edge outward, clicks pass immediately to background
      setClickThrough(true);
      if (isBarVisible) {
        resetIdleTimer();
      }

      // Only reveal dock when dock is hidden and mouse touches the right edge summon trigger
      // (within 20px of right screen edge and within 240px of vertical center)
      if (!isBarVisible) {
        const isNearRightEdge = e.clientX > (window.innerWidth - 20) &&
          Math.abs(e.clientY - window.innerHeight / 2) < 240;

        if (isNearRightEdge) {
          showDock();
        }
      }
    }
  });

  bar.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    isPointerDown = true;
    isInteractingWithDock = true;
    clearTimeout(idleTimer);
    setClickThrough(false);
  });

  window.addEventListener('mouseleave', () => {
    mouseState.targetX = -9999;
    mouseState.targetY = -9999;
    mouseState.targetProximity = 0;
    requestRender();
    if (!isPointerDown && !isAnyModalOpen()) {
      isInteractingWithDock = false;
      setClickThrough(true);
    }
  });

  document.addEventListener('mouseleave', () => {
    mouseState.targetX = -9999;
    mouseState.targetY = -9999;
    mouseState.targetProximity = 0;
    requestRender();
    if (!isPointerDown && !isAnyModalOpen()) {
      isInteractingWithDock = false;
      setClickThrough(true);
    }
  });


  window.addEventListener('resize', resize);

  // Global IPC Listeners from Electron Main Process
  if (window.edgeLightAPI) {
    window.edgeLightAPI.onToggleLight(() => {
      if (stream) {
        stopAuto();
      }
      setOn(!state.on);
      showStatus(state.on ? 'Edge Light On ✨' : 'Edge Light Off', 2500);
    });

    window.edgeLightAPI.onToggleControls?.(() => {
      if (bar.classList.contains('visible')) {
        forceHideDock();
      } else {
        showDock();
      }
    });

    window.edgeLightAPI.onSetLightState((desiredState) => {
      if (stream) {
        stopAuto();
      }
      setOn(desiredState);
    });
  }

  // Fullscreen management supporting both native Electron and browser mode
  async function toggleFullscreen() {
    try {
      if (window.edgeLightAPI?.toggleFullScreen) {
        const isFS = await window.edgeLightAPI.toggleFullScreen();
        updateFullscreenUI(isFS);
      } else if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        updateFullscreenUI(true);
      } else {
        await document.exitFullscreen();
        updateFullscreenUI(false);
      }
    } catch (e) {
      console.error('Fullscreen toggle error:', e);
    }
  }

  function updateFullscreenUI(isFS) {
    if (fullscreenBtn) {
      fullscreenBtn.title = isFS
        ? 'Exit Fullscreen (Esc or F)'
        : 'Toggle Fullscreen (F)';
      fullscreenBtn.setAttribute('aria-pressed', isFS ? 'true' : 'false');
      fullscreenBtn.classList.toggle('active', isFS);
    }
  }

  // Keyboard shortcut fallback for in-window focus
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      if (stream) {
        stopAuto();
      }
      setOn(!state.on);
      showDock();
    }
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey
        && e.target.tagName !== 'INPUT') {
      toggleFullscreen();
    }
  });

  // Fullscreen button
  fullscreenBtn?.addEventListener('click', () => {
    toggleFullscreen();
  });

  document.addEventListener('fullscreenchange', () => {
    updateFullscreenUI(!!document.fullscreenElement);
  });

  /* ============================================================
     Real-Time Camera-Assisted Ambient Light Detection
     ============================================================ */
  let videoEl = null;
  let canvasEl = null;
  let vctx = null;
  let sampleIntervalId = null;
  let stream = null;
  let smoothLuminance = null;
  let lastAutoState = null;
  let isCameraOff = false;
  let isTrackMuted = false;

  function handleCameraOff() {
    if (!isCameraOff) {
      isCameraOff = true;
      showStatus('📷 Camera off / closed — Edge Light Off', 2400);
    }
    if (privacyNote) {
      privacyNote.classList.remove('visible');
    }
    // Crucial requirement: when camera is off/inactive, edge light must also be off
    if (state.on) {
      setOn(false);
    }
    smoothLuminance = null;
    if (liveLux) {
      liveLux.textContent = '· Off';
      liveLux.style.color = 'rgba(255, 255, 255, 0.42)';
      liveLux.title = 'Camera is off or privacy shutter closed';
    }
  }

  function handleCameraOn() {
    if (isCameraOff) {
      isCameraOff = false;
      smoothLuminance = null;
      showStatus('📷 Camera active — metering ambient light…', 1800);
    }
  }

  async function startAuto() {
    // In Electron, Edge Light utilizes passive Windows Registry CapabilityAccessManager
    // monitoring to detect camera usage with zero hardware device locking or video stream interruption.
    // This guarantees WhatsApp, Zoom, Teams, and browsers always have 100% uninterrupted,
    // clean video feeds with zero black screens.
    if (window.edgeLightAPI?.onWebcamAccessChanged) {
      isCameraOff = false;
      isTrackMuted = false;
      autoWebcamEnabled = true;
      autoSwitch?.setAttribute('aria-checked', 'true');
      if (thresholdWrap) thresholdWrap.classList.add('active');
      showStatus('📷 Auto camera detection active ✨', 2200);
      if (currentWebcamInUse && !state.on) {
        wasTurnedOnByWebcam = true;
        setOn(true);
      }
      return;
    }

    showStatus('📷 Initializing real-time camera sensor…', 1500);
    isCameraOff = false;
    isTrackMuted = false;
    videoUnreadyCount = 0;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Webcam API unavailable in this environment');
      }

      // Request user-facing laptop camera with gentle ideal constraints, fallback to video: true
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          },
          audio: false
        });
      } catch (err1) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }

      if (!stream || stream.getVideoTracks().length === 0) {
        throw new Error('No active camera tracks available');
      }

      const videoTrack = stream.getVideoTracks()[0];
      videoTrack.addEventListener('mute', () => {
        isTrackMuted = true;
        handleCameraOff();
      });
      videoTrack.addEventListener('unmute', () => {
        isTrackMuted = false;
        handleCameraOn();
      });
      videoTrack.addEventListener('ended', () => {
        isTrackMuted = true;
        handleCameraOff();
      });

      autoSwitch?.setAttribute('aria-checked', 'true');
      if (thresholdWrap) thresholdWrap.classList.add('active');
      if (privacyNote && bar.classList.contains('visible') && state.on) {
        privacyNote.classList.add('visible');
      }
      smoothLuminance = null;
      lastAutoState = state.on;

      if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.id = 'camera-video-hidden';
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('autoplay', '');
        videoEl.muted = true;
        videoEl.defaultMuted = true;
        // Non-zero dimensions & active styling ensure Chromium keeps stream decoding active
        videoEl.style.cssText = 'position:fixed;bottom:0;right:0;width:160px;height:120px;opacity:0.01;pointer-events:none;z-index:-999;';
        document.body.appendChild(videoEl);
      }

      videoEl.srcObject = stream;
      try {
        await videoEl.play();
      } catch (e) {}

      if (!canvasEl) {
        canvasEl = document.createElement('canvas');
        canvasEl.width = 64;
        canvasEl.height = 48;
      }
      vctx = canvasEl.getContext('2d', { willReadFrequently: true });

      // Start continuous sampling loop (~12 evaluations per sec)
      startSampling();
      showStatus('📷 Auto light sensor active ✨', 2200);

    } catch (err) {
      stopAuto();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        showStatus('Camera access denied — auto mode unavailable.', 4000);
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        showStatus('Camera busy or off — auto mode unavailable.', 4000);
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        showStatus('No camera found or camera is off.', 4000);
      } else {
        showStatus('Camera unavailable or off — auto mode disabled.', 4000);
      }
    }
  }

  function startSampling() {
    stopSampling();
    // Immediate evaluation once stream is active
    sampleFromVideo();
    // Rock-solid continuous interval that Chromium never stalls or throttles
    sampleIntervalId = setInterval(() => {
      sampleFromVideo();
    }, 85);
  }

  function stopSampling() {
    if (sampleIntervalId) {
      clearInterval(sampleIntervalId);
      sampleIntervalId = null;
    }
  }

  function stopAuto() {
    stopSampling();
    isCameraOff = false;
    isTrackMuted = false;
    if (stream) {
      try {
        stream.getTracks().forEach((track) => track.stop());
      } catch (e) {}
      stream = null;
    }
    if (videoEl) {
      try {
        videoEl.srcObject = null;
        videoEl.remove();
      } catch (e) {}
      videoEl = null;
    }
    vctx = null;
    smoothLuminance = null;
    lastAutoState = null;
    autoSwitch?.setAttribute('aria-checked', 'false');
    thresholdWrap?.classList.remove('active');
    if (privacyNote) privacyNote.classList.remove('visible');
    if (liveLux) liveLux.textContent = '';
    hideStatus();
  }

  let videoUnreadyCount = 0;

  function sampleFromVideo() {
    if (!stream || !videoEl || !vctx) return;

    // Check if video track is muted or ended (camera disabled / turned off via hardware or hotkey)
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live' || videoTrack.muted || isTrackMuted) {
      handleCameraOff();
      return;
    }

    if (videoEl.readyState >= 2 && (videoEl.videoWidth > 0 || videoEl.currentTime > 0)) {
      videoUnreadyCount = 0;
      try {
        vctx.drawImage(videoEl, 0, 0, 64, 48);
        computeLuminance();
      } catch (e) {
        handleCameraOff();
      }
    } else {
      videoUnreadyCount++;
      // Allow initial stream frames ~340ms to arrive before declaring camera off
      if (videoUnreadyCount > 4) {
        handleCameraOff();
      }
    }
  }

  function computeLuminance() {
    if (!vctx) return;
    try {
      const imgData = vctx.getImageData(0, 0, 64, 48).data;
      let totalWeight = 0;
      let weightedSum = 0;
      let nonZeroCount = 0;
      let maxSampleLum = 0;

      // Center-weighted face/ambient metering:
      // Focus on the central ~50% region where the user's face and room center sit
      for (let y = 0; y < 48; y += 2) {
        const isCenterY = y >= 12 && y <= 36;
        for (let x = 0; x < 64; x += 2) {
          const isCenterX = x >= 16 && x <= 48;
          const weight = (isCenterX && isCenterY) ? 2.2 : 1.0;
          const idx = (y * 64 + x) * 4;
          const r = imgData[idx];
          const g = imgData[idx + 1];
          const b = imgData[idx + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum > 2.0) nonZeroCount++;
          if (lum > maxSampleLum) maxSampleLum = lum;
          weightedSum += lum * weight;
          totalWeight += weight;
        }
      }

      const rawLuminance = totalWeight > 0 ? (weightedSum / totalWeight) : 0;

      // Detect Camera Off / Shutter Closed / Hardware Disabled:
      // When privacy shutter is closed, lens covered, or sensor switched off,
      // driver outputs pure digital black (maxSampleLum <= 2.0 and nonZeroCount < 3).
      if (maxSampleLum <= 2.0 && nonZeroCount < 3) {
        handleCameraOff();
        return;
      }

      // Valid camera frames received -> camera is active
      handleCameraOn();

      // Screen self-illumination compensation:
      // When Edge Light is illuminated, screen reflection raises the camera reading by ~10-12 units.
      // Compensating prevents the edge light from hunting or turning itself back off.
      const screenLight = (state.on ? 11 : 0) * (renderState.brightness || 1.0);
      const ambientLuminance = Math.max(0, rawLuminance - screenLight);

      // Responsive Exponential Moving Average (< 180ms adaptation to room lighting changes)
      if (smoothLuminance === null) {
        smoothLuminance = ambientLuminance;
      } else {
        smoothLuminance = smoothLuminance * 0.65 + ambientLuminance * 0.35;
      }

      const currentLux = Math.round(smoothLuminance);
      const threshold = state.autoThreshold;

      // Live readout in UI: update threshold label in real-time
      if (liveLux) {
        liveLux.textContent = `· ${currentLux}`;
        liveLux.style.color = currentLux < threshold ? '#ffb366' : '#85d2ff';
        liveLux.title = 'Ambient light sensor reading';
      }

      // Deadband hysteresis prevents flicker around the boundary
      const HYSTERESIS = 3.5;
      let shouldBeOn = state.on;

      if (smoothLuminance < threshold - HYSTERESIS) {
        shouldBeOn = true;
      } else if (smoothLuminance > threshold + HYSTERESIS) {
        shouldBeOn = false;
      }

      if (state.on !== shouldBeOn) {
        setOn(shouldBeOn);
        showStatus(shouldBeOn
          ? `🌑 Low light (${currentLux}) — Edge Light On ✨`
          : `☀️ Ambient bright (${currentLux}) — Edge Light Off`, 2200);
      }
    } catch (e) {}
  }

  function cleanAppName(name) {
    if (!name) return '';
    let clean = name.replace(/^.*[#\\]/, '');
    clean = clean.replace(/\.exe$/i, '');
    const lower = clean.toLowerCase();
    if (lower.includes('chrome')) return 'Chrome';
    if (lower.includes('msedge') || lower === 'edge') return 'Edge';
    if (lower.includes('firefox')) return 'Firefox';
    if (lower.includes('windowscamera')) return 'Camera';
    if (lower.includes('whatsapp')) return 'WhatsApp';
    if (lower.includes('zoom')) return 'Zoom';
    if (lower.includes('teams')) return 'Teams';
    if (lower.includes('discord')) return 'Discord';
    if (lower.includes('skype')) return 'Skype';
    if (lower.includes('obs')) return 'OBS';
    return clean;
  }

  function handleWebcamAccessChange(inUse, activeApps) {
    currentWebcamInUse = inUse;
    if (!autoWebcamEnabled) return;

    if (inUse) {
      if (!manualTurnedOffWhileWebcamActive) {
        wasTurnedOnByWebcam = true;
        if (!state.on) {
          setOn(true);
          const appLabel = activeApps && activeApps[0] ? ` (${cleanAppName(activeApps[0])})` : '';
          showStatus(`📷 Camera active${appLabel} — Edge Light on ✨`, 2600);
        }
      }
    } else {
      manualTurnedOffWhileWebcamActive = false;
      if (wasTurnedOnByWebcam && state.on) {
        wasTurnedOnByWebcam = false;
        setOn(false);
        showStatus('📷 Camera released — Edge Light off', 2200);
      }
    }
  }
  window.__handleWebcamAccessChange = handleWebcamAccessChange;

  if (window.edgeLightAPI?.onWebcamAccessChanged) {
    window.edgeLightAPI.onWebcamAccessChanged((inUse, activeApps) => {
      handleWebcamAccessChange(inUse, activeApps);
    });
  }

  function toggleAuto() {
    autoWebcamEnabled = !autoWebcamEnabled;
    autoSwitch?.setAttribute('aria-checked', autoWebcamEnabled ? 'true' : 'false');
    if (thresholdWrap) {
      thresholdWrap.classList.toggle('active', autoWebcamEnabled);
    }
    if (autoWebcamEnabled) {
      showStatus('📷 Auto camera detection active ✨', 2200);
      if (currentWebcamInUse && !state.on) {
        wasTurnedOnByWebcam = true;
        setOn(true);
      }
    } else {
      showStatus('Auto camera detection paused', 2000);
      if (wasTurnedOnByWebcam && state.on) {
        wasTurnedOnByWebcam = false;
        setOn(false);
      }
    }
  }

  // Set Auto switch active by default for MacBook-style instant camera detection
  autoSwitch?.setAttribute('aria-checked', 'true');

  autoSwitch?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAuto();
  });
  autoLabel?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAuto();
  });
  autoSwitchWrap?.addEventListener('click', (e) => {
    if (e.target !== autoSwitch && !autoSwitch?.contains(e.target) && e.target !== autoLabel) {
      toggleAuto();
    }
  });

  window.addEventListener('beforeunload', stopAuto);

  // Initialize display
  resize();

  // ─ Startup bloom-in: ring expands inward smoothly from screen edge ─
  thickScaleTime   = performance.now();
  thickScaleFrom   = 0.0;
  thickScaleTarget = 1.0;
  thickScaleDir    = 1;
  requestRender();

  // Ensure default click-through mode is engaged (dock hidden by default)
  setClickThrough(true);

  // ── LICENSE & HWID MODAL MANAGEMENT ──────────────────────────────
  function updateLicenseUI(info) {
    if (!info) return;
    licenseState = info;

    if (hwidDisplay) {
      hwidDisplay.textContent = info.hwid || 'XXXX-XXXX-XXXX-XXXX';
    }

    if (licenseBadge) {
      licenseBadge.className = 'license-badge';
      if (info.status === 'approved') {
        licenseBadge.textContent = '✓ Pro';
        licenseBadge.classList.add('licensed');
        licenseBadge.title = 'Commercial Lifetime License Active';
      } else if (info.status === 'rejected') {
        licenseBadge.textContent = 'Blocked';
        licenseBadge.classList.add('rejected');
        licenseBadge.title = 'Device access revoked by administrator';
      } else if (info.status === 'expired' || info.status === 'clock_tampered') {
        licenseBadge.textContent = 'Expired';
        licenseBadge.classList.add('expired');
        licenseBadge.title = 'Free Trial Expired — Activation Required';
      } else {
        const days = info.trialRemainingDays;
        const hours = info.trialRemainingHours % 24;
        licenseBadge.textContent = `Trial: ${days > 0 ? days + 'd' : hours + 'h'}`;
        licenseBadge.title = `3-Day Free Trial: ${info.trialRemainingHours}h remaining`;
      }
    }

    if (modalStatusBadge) {
      modalStatusBadge.className = 'license-status-badge';
      if (info.status === 'approved') {
        modalStatusBadge.textContent = '✓ Commercial License Active';
        modalStatusBadge.classList.add('approved');
      } else if (info.status === 'rejected' || info.status === 'revoked') {
        modalStatusBadge.textContent = '🚫 Device Access Revoked';
        modalStatusBadge.classList.add('rejected');
      } else if (info.status === 'expired') {
        modalStatusBadge.textContent = '⌛ 3-Day Free Trial Expired';
        modalStatusBadge.classList.add('expired');
      } else if (info.status === 'clock_tampered') {
        modalStatusBadge.textContent = '⚠️ System Clock Tampering Detected';
        modalStatusBadge.classList.add('expired');
      } else {
        const days = info.trialRemainingDays;
        const hours = info.trialRemainingHours % 24;
        modalStatusBadge.textContent = `⏳ Free Trial Active (${days > 0 ? days + 'd ' : ''}${hours}h left)`;
      }
    }

    if (licenseDescription) {
      if (info.status === 'approved') {
        if (info.expiresAt) {
          licenseDescription.textContent = `Active ${info.planName || 'Commercial Pass'}. Valid through ${new Date(info.expiresAt).toLocaleDateString()}. All pro screen ring features are unlocked.`;
        } else {
          licenseDescription.textContent = 'This device is permanently licensed (Lifetime Pro). All pro features and real-time screen ring illumination are fully unlocked forever.';
        }
        if (info.licenseKey) {
          licenseDescription.textContent += ` [Key: ${info.licenseKey}]`;
        }
      } else if (info.status === 'rejected' || info.status === 'revoked') {
        licenseDescription.textContent = 'Access for this machine has been restricted by the administrator. Contact your administrator with the Hardware ID above if you believe this was in error.';
      } else if (info.status === 'expired') {
        licenseDescription.textContent = 'Your 3-day free evaluation period has concluded. To continue using Edge Light, please choose an affordable pass under ₹100 or share your Hardware ID with your administrator.';
      } else {
        licenseDescription.textContent = 'Every machine automatically receives a 72-hour free evaluation window. When ready to upgrade, choose an affordable pass under ₹100.';
      }
    }

    // If unauthorized, turn off ring and lock
    if (!info.isAuthorized) {
      if (state.on) {
        setOn(false);
      }
      power.classList.remove('active');
      power.setAttribute('aria-pressed', 'false');
      power.title = 'License required — Click to view HWID';
    } else {
      power.title = state.on ? 'Turn Off (Ctrl+Shift+L)' : 'Turn On (Ctrl+Shift+L)';
    }

    if (openPlansFromLicenseBtn) {
      if (info.status === 'approved') {
        openPlansFromLicenseBtn.textContent = '✓ Commercial License Active';
        openPlansFromLicenseBtn.classList.remove('pulse-glow');
        openPlansFromLicenseBtn.style.opacity = '0.85';
      } else {
        openPlansFromLicenseBtn.textContent = '💳 Upgrade / View Plans (from ₹29)';
        openPlansFromLicenseBtn.classList.add('pulse-glow');
        openPlansFromLicenseBtn.style.opacity = '1';
      }
    }
  }

  // ── REAL-TIME LIVE LICENSE SYNCHRONIZATION ────────────────────────
  let liveLicenseSyncTimer = null;
  let isCheckingLicense = false;

  async function checkLiveLicense() {
    if (isCheckingLicense) return;
    isCheckingLicense = true;
    try {
      if (window.edgeLightAPI?.refreshLicenseInfo) {
        const updated = await window.edgeLightAPI.refreshLicenseInfo();
        if (updated) {
          updateLicenseUI(updated);
        }
      }
    } catch (e) {
    } finally {
      isCheckingLicense = false;
    }
  }

  function startLiveLicenseSync() {
    if (liveLicenseSyncTimer) clearInterval(liveLicenseSyncTimer);
    checkLiveLicense();
    // Real-time live check every 2.5 seconds while modal is open
    liveLicenseSyncTimer = setInterval(() => {
      if (isAnyModalOpen()) {
        checkLiveLicense();
      } else {
        stopLiveLicenseSync();
      }
    }, 2500);
  }

  function stopLiveLicenseSync() {
    if (liveLicenseSyncTimer) {
      clearInterval(liveLicenseSyncTimer);
      liveLicenseSyncTimer = null;
    }
  }

  function showLicenseModal() {
    if (!licenseModal) return;
    setClickThrough(false);
    licenseModal.classList.add('visible');
    if (window.edgeLightAPI?.bringToFront) {
      window.edgeLightAPI.bringToFront();
    }
    startLiveLicenseSync();
  }

  function hideLicenseModal() {
    if (!licenseModal) return;
    licenseModal.classList.remove('visible');
    if (!wizardModal?.classList.contains('visible')) {
      stopLiveLicenseSync();
    }
    if (!bar.classList.contains('visible') && !isAnyModalOpen()) {
      setClickThrough(true);
    }
  }

  licenseBadge?.addEventListener('click', (e) => {
    e.stopPropagation();
    showLicenseModal();
  });

  closeLicenseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideLicenseModal();
  });

  licenseModal?.addEventListener('click', (e) => {
    if (e.target === licenseModal) {
      hideLicenseModal();
    }
  });

  copyHwidBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const hwid = hwidDisplay?.textContent || '';
    if (window.edgeLightAPI?.copyHWID) {
      await window.edgeLightAPI.copyHWID();
    } else {
      navigator.clipboard?.writeText(hwid);
    }
    copyHwidBtn.textContent = '✓ Copied!';
    showStatus('📋 HWID copied to clipboard', 2000);
    setTimeout(() => {
      copyHwidBtn.textContent = '📋 Copy';
    }, 1800);
  });

  // ── SETUP WIZARD & DIRECT BUYING (UNDER ₹100) ──────────────────────
  const closeWizardBtn = document.getElementById('closeWizardBtn');
  const openPlansFromLicenseBtn = document.getElementById('openPlansFromLicenseBtn');
  const stepTabs = document.querySelectorAll('.wizard-steps .step-tab');
  const stepPanes = document.querySelectorAll('.wizard-step-pane');
  const calDisplayRes = document.getElementById('calDisplayRes');
  const calThickness = document.getElementById('calThickness');
  const testLightBtn = document.getElementById('testLightBtn');
  const step1NextBtn = document.getElementById('step1NextBtn');
  const wizardHwidPill = document.getElementById('wizardHwidPill');
  const wizardHwidCode = document.getElementById('wizardHwidCode');
  const wizardCopyHwidBtn = document.getElementById('wizardCopyHwidBtn');
  const skipToTrialFinishBtn = document.getElementById('skipToTrialFinishBtn');
  const step2UpgradeBtn = document.getElementById('step2UpgradeBtn');
  const planCards = document.querySelectorAll('.pricing-plans-grid .plan-card');
  const selectedPlanTitle = document.getElementById('selectedPlanTitle');
  const selectedPlanPrice = document.getElementById('selectedPlanPrice');
  const rzpBtnPrice = document.getElementById('rzpBtnPrice');
  const razorpayDirectBtn = document.getElementById('razorpayDirectBtn');
  const upiQrImg = document.getElementById('upiQrImg');
  const upiIdDisplay = document.getElementById('upiIdDisplay');
  const step3BackBtn = document.getElementById('step3BackBtn');
  const step3NextBtn = document.getElementById('step3NextBtn');
  const finishWizardBtn = document.getElementById('finishWizardBtn');

  const SETUP_COMPLETED_KEY = 'edgelight_setup_completed_v1';
  let currentWizardStep = 1;
  let currentSelectedPlanId = 'quarterly';
  let paymentConfig = {
    keyId: 'rzp_live_PLACEHOLDER',
    upiId: 'edgelight@upi',
    plans: {
      monthly: { id: 'monthly', name: 'Monthly Pass', price: 29, link: 'https://rzp.io/l/edgelight-monthly' },
      quarterly: { id: 'quarterly', name: '3-Month Pass', price: 49, link: 'https://rzp.io/l/edgelight-quarterly' },
      lifetime: { id: 'lifetime', name: 'Lifetime Pro', price: 99, link: 'https://rzp.io/l/edgelight-lifetime' }
    }
  };

  // Load payment config from main process
  if (window.edgeLightAPI?.getPaymentConfig) {
    window.edgeLightAPI.getPaymentConfig().then((cfg) => {
      if (cfg && cfg.plans) {
        paymentConfig = cfg;
        if (upiIdDisplay && cfg.upiId) {
          upiIdDisplay.textContent = `UPI: ${cfg.upiId}`;
        }
        updateSelectedPlanUI(currentSelectedPlanId);
      }
    }).catch(() => {});
  }

  // Update calibration info on step 1 based on actual screen
  if (calDisplayRes && calThickness) {
    const sw = window.screen.width;
    const sh = window.screen.height;
    calDisplayRes.textContent = `${sw} × ${sh} (${sw >= 2560 ? 'QHD/4K' : sw >= 1920 ? 'Full HD' : 'Standard HD'})`;
    calThickness.textContent = `${state.thickness}px Calibrated Ring`;
  }

  function goToWizardStep(step) {
    currentWizardStep = Math.max(1, Math.min(4, step));

    stepPanes.forEach((pane) => {
      pane.classList.remove('active');
    });
    const activePane = document.getElementById(`wizardStep${currentWizardStep}`);
    if (activePane) activePane.classList.add('active');

    stepTabs.forEach((tab) => {
      const s = parseInt(tab.dataset.step, 10);
      tab.classList.toggle('active', s === currentWizardStep);
      tab.classList.toggle('completed', s < currentWizardStep);
    });
  }

  function updateSelectedPlanUI(planId) {
    currentSelectedPlanId = planId;
    const plansSource = paymentConfig.plansById || (Array.isArray(paymentConfig.plans)
      ? paymentConfig.plans.reduce((acc, p) => { acc[p.id] = p; return acc; }, {})
      : paymentConfig.plans);
    const plan = plansSource?.[planId] || plansSource?.quarterly || { id: planId, name: 'Pass', price: 49 };

    planCards.forEach((card) => {
      const isSelected = card.dataset.planId === planId;
      card.classList.toggle('selected', isSelected);
      const tag = card.querySelector('.plan-select-tag');
      if (tag) tag.textContent = isSelected ? 'Selected ✓' : 'Select';
    });

    if (selectedPlanTitle) selectedPlanTitle.textContent = plan.name;
    if (selectedPlanPrice) selectedPlanPrice.textContent = `₹${plan.price}`;
    if (rzpBtnPrice) rzpBtnPrice.textContent = `₹${plan.price}`;

    // Generate standard UPI Intent URL and render QR code
    const upiId = paymentConfig.upiId || 'edgelight@upi';
    const hwid = licenseState.hwid || 'TRIAL';
    const upiPayload = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=EdgeLight&am=${plan.price}&cu=INR&tn=EdgeLight-${plan.id}-${hwid}`;
    if (upiQrImg) {
      upiQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(upiPayload)}`;
    }
  }

  function showSetupWizard(initialStep = 1) {
    setClickThrough(false);
    goToWizardStep(initialStep);
    wizardModal?.classList.add('visible');
    if (window.edgeLightAPI?.bringToFront) {
      window.edgeLightAPI.bringToFront();
    }
    startLiveLicenseSync();
  }

  function hideSetupWizard() {
    wizardModal?.classList.remove('visible');
    if (!licenseModal?.classList.contains('visible')) {
      stopLiveLicenseSync();
    }
    if (!bar.classList.contains('visible') && !isAnyModalOpen()) {
      setClickThrough(true);
    }
  }

  function completeWizard() {
    try {
      localStorage.setItem(SETUP_COMPLETED_KEY, 'true');
    } catch (e) {}
    hideSetupWizard();
    showStatus('✨ Edge Light is active & ready!', 2500);
  }

  // Step 1 event listeners
  step1NextBtn?.addEventListener('click', () => goToWizardStep(2));

  testLightBtn?.addEventListener('click', () => {
    setOn(!state.on);
    testLightBtn.textContent = state.on ? '💡 Light ON (Click to Off)' : '💡 Test Glow Preview';
  });

  // Step 2 event listeners
  skipToTrialFinishBtn?.addEventListener('click', () => completeWizard());
  step2UpgradeBtn?.addEventListener('click', () => goToWizardStep(3));

  // Step 3 plan cards and checkout listeners
  planCards.forEach((card) => {
    card.addEventListener('click', () => {
      const planId = card.dataset.planId;
      if (planId) updateSelectedPlanUI(planId);
    });
  });

  razorpayDirectBtn?.addEventListener('click', async () => {
    const plansSource = paymentConfig.plansById || (Array.isArray(paymentConfig.plans)
      ? paymentConfig.plans.reduce((acc, p) => { acc[p.id] = p; return acc; }, {})
      : paymentConfig.plans);
    const plan = plansSource?.[currentSelectedPlanId] || plansSource?.quarterly || {};
    let url = plan.link || 'https://rzp.io/rzp/01mOm4K';
    const hwid = wizardHwidCode?.textContent || licenseState.hwid || '';

    showStatus(`⚡ Launching Razorpay checkout (₹${plan.price || 49})…`, 3000);

    if (window.edgeLightAPI?.createRazorpayPaymentLink) {
      try {
        const dynamicUrl = await window.edgeLightAPI.createRazorpayPaymentLink({
          planId: currentSelectedPlanId || 'quarterly',
          hwid: hwid
        });
        if (dynamicUrl && dynamicUrl.startsWith('http')) {
          url = dynamicUrl;
        }
      } catch (err) {
        console.warn('[Razorpay] Dynamic checkout link fallback:', err);
      }
    }

    if (window.edgeLightAPI?.openExternal) {
      await window.edgeLightAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  });

  wizardCopyHwidBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const hwid = wizardHwidCode?.textContent || '';
    if (window.edgeLightAPI?.copyHWID) {
      await window.edgeLightAPI.copyHWID();
    } else {
      navigator.clipboard?.writeText(hwid);
    }
    wizardCopyHwidBtn.textContent = '✓ Copied!';
    setTimeout(() => {
      wizardCopyHwidBtn.textContent = '📋 Copy';
    }, 1800);
  });

  step3BackBtn?.addEventListener('click', () => goToWizardStep(2));
  step3NextBtn?.addEventListener('click', () => goToWizardStep(4));

  // Step 4 event listeners
  finishWizardBtn?.addEventListener('click', () => completeWizard());

  // Wizard tab clicking
  stepTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const s = parseInt(tab.dataset.step, 10);
      if (!isNaN(s)) goToWizardStep(s);
    });
  });

  closeWizardBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideSetupWizard();
  });

  wizardModal?.addEventListener('click', (e) => {
    if (e.target === wizardModal) {
      hideSetupWizard();
    }
  });

  // ESC key dismisses active modal
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (wizardModal?.classList.contains('visible')) {
        hideSetupWizard();
      } else if (licenseModal?.classList.contains('visible')) {
        hideLicenseModal();
      }
    }
  });

  openPlansFromLicenseBtn?.addEventListener('click', (e) => {
    e?.stopPropagation();
    hideLicenseModal();
    showSetupWizard(3);
  });

  // Initial update of HWID codes in wizard when license data arrives
  const origUpdateLicenseUI = updateLicenseUI;
  function enhancedUpdateLicenseUI(info) {
    origUpdateLicenseUI(info);
    const hwid = info?.hwid || info?.shortHwid;
    if (hwid) {
      if (wizardHwidPill) wizardHwidPill.textContent = `HWID: ${hwid}`;
      if (wizardHwidCode) wizardHwidCode.textContent = hwid;
      updateSelectedPlanUI(currentSelectedPlanId);
    }
  }
  updateLicenseUI = enhancedUpdateLicenseUI;

  // Show setup wizard on first run if not completed
  try {
    const hasCompleted = localStorage.getItem(SETUP_COMPLETED_KEY);
    if (!hasCompleted) {
      setTimeout(() => {
        showSetupWizard(1);
      }, 700);
    }
  } catch (e) {}

  window.__showLicenseModal = showLicenseModal;
  window.__hideLicenseModal = hideLicenseModal;
  window.__showSetupWizard = showSetupWizard;
  window.__hideSetupWizard = hideSetupWizard;
  window.__updateLicenseUI = updateLicenseUI;

  // Initialize license status from Electron main process
  if (window.edgeLightAPI?.getLicenseInfo) {
    window.edgeLightAPI.getLicenseInfo().then((info) => {
      updateLicenseUI(info);
    }).catch(() => {});
  }

  if (window.edgeLightAPI?.onLicenseStatusChanged) {
    window.edgeLightAPI.onLicenseStatusChanged((info) => {
      updateLicenseUI(info);
    });
  }

  if (window.edgeLightAPI?.onShowLicenseModal) {
    window.edgeLightAPI.onShowLicenseModal(() => {
      showLicenseModal();
    });
  }

  if (window.edgeLightAPI?.onShowSetupWizard) {
    window.edgeLightAPI.onShowSetupWizard(() => {
      showSetupWizard(1);
    });
  }

  // Display app version on dock badge
  const versionBadgeEl = document.getElementById('version-badge');
  if (versionBadgeEl) {
    if (window.edgeLightAPI?.getAppVersion) {
      window.edgeLightAPI.getAppVersion().then((ver) => {
        if (ver) versionBadgeEl.textContent = `v${ver}`;
      }).catch(() => {
        versionBadgeEl.textContent = 'v1.0.4';
      });
    } else {
      versionBadgeEl.textContent = 'v1.0.4';
    }
  }

  // ── OVER-THE-AIR (OTA) UPDATE CONTROLLER ──────────────────────────
  const otaBanner = document.getElementById('ota-banner');
  const otaVersion = document.getElementById('ota-version');
  const otaProgressBox = document.getElementById('ota-progress-box');
  const otaProgressFill = document.getElementById('ota-progress-fill');
  const otaProgressText = document.getElementById('ota-progress-text');
  const otaActionBtn = document.getElementById('ota-action-btn');
  const otaCloseBtn = document.getElementById('ota-close-btn');

  let currentOtaUpdate = null;
  let otaStatus = 'available'; // 'available' | 'downloading' | 'ready'

  function showOtaBanner(updateInfo) {
    if (!otaBanner || !updateInfo || !updateInfo.updateAvailable) return;
    currentOtaUpdate = updateInfo;
    otaStatus = 'available';
    if (otaVersion) otaVersion.textContent = `v${updateInfo.latestVersion}`;
    if (otaActionBtn) {
      otaActionBtn.textContent = 'Update Now';
      otaActionBtn.classList.remove('downloading');
    }
    if (otaProgressBox) otaProgressBox.classList.add('hidden');
    otaBanner.classList.add('visible');
    setClickThrough(false);
  }

  function hideOtaBanner() {
    if (!otaBanner) return;
    otaBanner.classList.remove('visible');
    if (!isAnyModalOpen() && !bar.classList.contains('visible')) {
      setClickThrough(true);
    }
  }

  otaCloseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideOtaBanner();
  });

  otaActionBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (otaStatus === 'available') {
      if (!currentOtaUpdate?.downloadUrl) {
        showStatus('Opening releases page...', 2500);
        window.edgeLightAPI?.openExternal?.('https://github.com/CHAUHANRUDRA24/edgelight-app/releases/latest');
        hideOtaBanner();
        return;
      }
      otaStatus = 'downloading';
      otaActionBtn.textContent = 'Downloading...';
      otaActionBtn.classList.add('downloading');
      otaProgressBox?.classList.remove('hidden');
      if (otaProgressFill) otaProgressFill.style.setProperty('--progress', '0%');
      if (otaProgressText) otaProgressText.textContent = '0%';

      try {
        if (window.edgeLightAPI?.downloadUpdate) {
          const res = await window.edgeLightAPI.downloadUpdate(currentOtaUpdate.downloadUrl);
          if (res && res.success) {
            otaStatus = 'ready';
            otaActionBtn.classList.remove('downloading');
            otaActionBtn.textContent = 'Restart & Install';
            otaProgressBox?.classList.add('hidden');
            showStatus('✓ Update downloaded. Click to restart & install.', 3500);
          }
        }
      } catch (err) {
        console.error('Download update error:', err);
        otaStatus = 'available';
        otaActionBtn.classList.remove('downloading');
        otaActionBtn.textContent = 'Retry Update';
        otaProgressBox?.classList.add('hidden');
        showStatus('Download failed: ' + err.message, 3000);
      }
    } else if (otaStatus === 'ready') {
      otaActionBtn.textContent = 'Restarting...';
      try {
        if (window.edgeLightAPI?.installUpdate) {
          window.edgeLightAPI.installUpdate();
        }
      } catch (err) {
        showStatus('Install error: ' + err.message, 3000);
      }
    }
  });

  if (window.edgeLightAPI?.onUpdateProgress) {
    window.edgeLightAPI.onUpdateProgress((prog) => {
      const p = prog.percent || 0;
      if (otaProgressFill) otaProgressFill.style.setProperty('--progress', `${p}%`);
      if (otaProgressText) otaProgressText.textContent = `${p}%`;
    });
  }

  if (window.edgeLightAPI?.onUpdateAvailable) {
    window.edgeLightAPI.onUpdateAvailable((info) => {
      showOtaBanner(info);
    });
  }
})();
