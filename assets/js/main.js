/* ============================================================
   Seaside Pixel Port — main.js
   One rAF loop drives parallax, waves, weather, the sailing ship,
   the anchor cursor, and the bubble trail.
   All reads happen in measure()/observers; tick() only writes.
   ============================================================ */
(() => {
  'use strict';

  const html = document.documentElement;
  const body = document.body;
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
  };

  /* ---------- State ---------- */
  const S = {
    scrollY: window.scrollY || 0,
    lastScrollY: window.scrollY || 0,
    dir: 1,
    vw: window.innerWidth,
    vh: window.innerHeight,
    maxScroll: 1,
    t: 0,
    heroVisible: true,
    motion: true,          // full motion
    mobile: false,         // cached mqMobile.matches — tick() must not read media queries
    scrolledAt: 0,
    running: false,
    rafId: 0
  };

  /* ---------- Motion preference ---------- */
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mqCoarse = matchMedia('(hover: none), (pointer: coarse)');
  const mqMobile = matchMedia('(max-width: 768px)');

  function resolveMotion() {
    const saved = store.get('spp-motion', null);       // 'full' | 'reduced' | null
    if (saved === 'full')    return true;
    if (saved === 'reduced') return false;
    return !mqReduce.matches;                            // default to OS preference
  }

  function applyMotion(on) {
    S.motion = on;
    html.setAttribute('data-motion', on ? 'full' : 'reduced');
    const btn = $('#motion-toggle');
    if (btn) btn.setAttribute('aria-pressed', String(on));
    if (on) startLoop(); else stopLoop();
    // the ship/water gate is pure CSS ([data-motion="reduced"] + the mobile query)
    // so it can't get latched into an inline style across a resize
    syncAnchor();
  }

  /* ---------- Anchor cursor gating ----------
     `cursor: none` is bound to html.anchor-cursor, and that class is only ever
     present when the sprite is genuinely on screen. So there is no window in
     which the user has no visible pointer: before the first pointermove, and
     whenever motion is off or the device is coarse, the real cursor is back
     (styled as a static anchor image by the CSS fallback). */
  function syncAnchor() {
    const ok = S.motion && !mqCoarse.matches && pointerMoved;
    html.classList.toggle('anchor-cursor', ok);
    if (anchorEl) anchorEl.classList.toggle('ready', ok);
  }

  /* ---------- Day / Night ---------- */
  const themeColorMeta = $('meta[name="theme-color"]');
  function resolveTime() {
    const saved = store.get('spp-time', null);
    if (saved === 'day' || saved === 'night') return saved;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
  }
  function applyTime(mode) {
    html.setAttribute('data-time', mode);
    if (themeColorMeta) themeColorMeta.setAttribute('content', mode === 'night' ? '#071726' : '#0E3B4A');
  }

  /* ============================================================
     WebAudio — synthesised, muted by default
     ============================================================ */
  const Sound = (() => {
    let ctx = null, master = null, ambientGain = null, ambientNode = null;
    let on = store.get('spp-sound', 'off') === 'on';

    function ensure() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.18; master.connect(ctx.destination);
    }
    function blip(freq = 520, dur = 0.06, type = 'square', vol = 0.5) {
      if (!on || !ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
    }
    function click() { blip(400, 0.05); setTimeout(() => blip(680, 0.06), 45); }
    function fanfare() {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.14, 'square', 0.6), i * 90));
    }
    function startAmbient() {
      if (!ctx || ambientNode) return;
      const bufSize = 2 * ctx.sampleRate;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
      ambientNode = ctx.createBufferSource(); ambientNode.buffer = buf; ambientNode.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      ambientGain = ctx.createGain(); ambientGain.gain.value = 0.10;
      ambientNode.connect(lp); lp.connect(ambientGain); ambientGain.connect(master);
      ambientNode.start();
    }
    function stopAmbient() {
      if (ambientNode) { try { ambientNode.stop(); } catch {} ambientNode = null; }
    }
    function setOn(v) {
      on = v; store.set('spp-sound', v ? 'on' : 'off');
      if (v) { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); startAmbient(); }
      else stopAmbient();
    }
    return {
      get on() { return on; },
      setOn, blip, click, fanfare,
      // called on first gesture to satisfy autoplay policy
      unlock() { if (on) { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); startAmbient(); } }
    };
  })();

  /* ============================================================
     DOM refs
     ============================================================ */
  const nav = $('#nav');
  const navList = $('#nav-list');
  const navCursor = $('#nav-cursor');
  const navLinks = $$('.nav-link');
  const sailerShip = $('#sailer-ship');
  const seaBack = $('.sea-band--back');
  const seaFront = $('.sea-band--front');
  const anchorEl = $('#anchor-cursor');
  const layers = $$('.parallax .layer');
  const wave1 = $('.wave-band--1');
  const wave2 = $('.wave-band--2');
  const fish = $('.fish');
  const cloudsLayer = $('.layer--clouds');
  const glintsBox = $('.glints');
  const starsBox = $('.stars');

  /* ============================================================
     Build decorative pixel elements
     ============================================================ */
  // stars
  if (starsBox) {
    for (let i = 0; i < 40; i++) {
      const s = document.createElement('i');
      s.style.left = (Math.random() * 100) + '%';
      s.style.top = (Math.random() * 100) + '%';
      s.style.animationDelay = (Math.random() * 3).toFixed(2) + 's';
      starsBox.appendChild(s);
    }
  }
  // sun glints
  if (glintsBox) {
    for (let i = 0; i < 7; i++) {
      const g = document.createElement('i');
      g.style.left = (10 + Math.random() * 80) + '%';
      g.style.top = (Math.random() * 40) + '%';
      g.style.animationDelay = (Math.random() * 2.6).toFixed(2) + 's';
      glintsBox.appendChild(g);
    }
  }

  // clouds
  const clouds = [];
  if (cloudsLayer) {
    const N = mqMobile.matches ? 2 : 4;
    for (let i = 0; i < N; i++) {
      const el = document.createElement('div');
      el.className = 'cloud';
      const w = 90 + Math.random() * 120;
      el.style.width = w + 'px';
      el.style.height = (w * 0.5) + 'px';
      el.style.top = (6 + Math.random() * 34) + '%';
      el.innerHTML = '<svg viewBox="0 0 20 10" preserveAspectRatio="none"><use href="#px-cloud"/></svg>';
      cloudsLayer.appendChild(el);
      clouds.push({ el, x: Math.random() * S.vw, y: 0, w, speed: 6 + Math.random() * 10 });
    }
  }

  // gulls
  const gulls = [];
  const gullN = mqMobile.matches ? 2 : 3;
  const gullHost = $('.layer--sky');
  if (gullHost) {
    for (let i = 0; i < gullN; i++) {
      const el = document.createElement('div');
      el.className = 'gull';
      el.style.width = (18 + Math.random() * 14) + 'px';
      el.innerHTML = '<svg viewBox="0 0 13 6"><use href="#px-gull"/></svg>';
      gullHost.appendChild(el);
      gulls.push({ el, phase: Math.random() * 1000, speed: 14 + Math.random() * 10, baseY: 12 + Math.random() * 26, amp: 14 + Math.random() * 16 });
    }
  }

  // rain pool + ripples
  const waveHost = $('.layer--waves');
  const rain = [];
  const ripples = [];
  if (waveHost) {
    const rN = mqMobile.matches ? 20 : 40;
    for (let i = 0; i < rN; i++) {
      const el = document.createElement('div');
      el.className = 'rain-drop';
      waveHost.appendChild(el);
      rain.push({ el, x: Math.random() * S.vw, y: Math.random() * 120, speed: 260 + Math.random() * 160 });
    }
    for (let i = 0; i < 8; i++) {
      const el = document.createElement('div');
      el.className = 'ripple';
      waveHost.appendChild(el);
      ripples.push({ el, active: false, x: 0, y: 0, life: 0 });
    }
  }

  // mist
  const mists = [];
  const skyHost = $('.layer--sky');
  if (skyHost) {
    for (let i = 0; i < 2; i++) {
      const el = document.createElement('div');
      el.className = 'mist';
      el.style.top = (40 + i * 18) + '%';
      skyHost.appendChild(el);
      mists.push({ el, x: -S.vw * 0.4, speed: 8 + i * 4 });
    }
  }

  // cursor trail bubbles
  const trailHost = $('#trail');
  const bubbles = [];
  if (trailHost && !mqCoarse.matches) {
    for (let i = 0; i < 12; i++) {
      const el = document.createElement('div');
      el.className = 'bubble';
      trailHost.appendChild(el);
      bubbles.push({ el, x: 0, y: 0, life: 0 });
    }
  }
  let bubbleIdx = 0, pointerX = 0, pointerY = 0, pointerMoved = false;

  // anchor cursor state — lerped position, pendulum swing, press squash
  const anchor = { x: 0, y: 0, down: false };

  /* ============================================================
     Measure (reads only) — cache geometry
     ============================================================ */
  function measure() {
    S.vw = window.innerWidth;
    S.vh = window.innerHeight;
    S.mobile = mqMobile.matches;
    S.maxScroll = Math.max(1, document.documentElement.scrollHeight - S.vh);
  }

  /* ============================================================
     Weather cycle
     ============================================================ */
  const WEATHERS = ['clear', 'clear', 'rain', 'mist'];
  let weatherIdx = 0;
  function cycleWeather() {
    weatherIdx = (weatherIdx + 1) % WEATHERS.length;
    body.setAttribute('data-weather', WEATHERS[weatherIdx]);
  }
  let weatherTimer = setInterval(() => { if (S.motion && !document.hidden) cycleWeather(); }, 12000);

  /* ============================================================
     The single rAF loop
     ============================================================ */
  function tick(now) {
    const dt = 1 / 60; // fixed-ish step for stable motion
    S.t = now || 0;
    const w = body.getAttribute('data-weather');

    // scroll direction (from cached scrollY)
    if (S.scrollY > S.lastScrollY + 0.5) S.dir = 1;
    else if (S.scrollY < S.lastScrollY - 0.5) S.dir = -1;
    const scrolling = Math.abs(S.scrollY - S.lastScrollY) > 0.5;
    S.lastScrollY = S.scrollY;

    // nav scrolled state (toggle on change only)
    const scrolled = S.scrollY > 40;
    if (scrolled !== S._scrolled) { nav.classList.toggle('scrolled', scrolled); S._scrolled = scrolled; }

    // ---- parallax (only while hero visible) ----
    if (S.heroVisible) {
      for (const layer of layers) {
        const d = parseFloat(layer.dataset.depth) || 0;
        layer.style.transform = `translate3d(0, ${(S.scrollY * d).toFixed(1)}px, 0)`;
      }
      // waves sway (seamless — band is wider than viewport)
      const sway = Math.sin(S.t * 0.0006);
      if (wave1) wave1.style.transform = `translateX(${(sway * 22 - 11).toFixed(1)}px)`;
      if (wave2) wave2.style.transform = `translateX(${(-sway * 26 + 13).toFixed(1)}px)`;

      // fish drifts across
      if (fish) {
        const span = S.vw + 120;
        const fx = ((S.t * 0.02) % span);
        fish.style.transform = `translateX(${fx.toFixed(1)}px)`;
        fish.style.opacity = fx > 30 && fx < span - 30 ? '0.5' : '0';
      }

      // clouds drift + wrap
      for (const c of clouds) {
        c.x += c.speed * dt;
        if (c.x > S.vw + c.w) c.x = -c.w;
        c.el.style.transform = `translateX(${c.x.toFixed(1)}px)`;
      }

      // gulls glide in arcs (only when clear)
      const gullOn = w === 'clear';
      for (const g of gulls) {
        if (!gullOn) { g.el.style.opacity = '0'; continue; }
        const span = S.vw + 120;
        const gx = (((S.t * 0.001 * g.speed) + g.phase) % span);
        const gy = g.baseY + Math.sin((S.t * 0.002) + g.phase) * g.amp;
        g.el.style.opacity = '0.9';
        g.el.style.transform = `translate(${(gx - 60).toFixed(1)}px, ${gy.toFixed(1)}vh)`;
      }

      // rain
      if (w === 'rain') {
        for (const r of rain) {
          r.y += r.speed * dt;
          r.x -= 40 * dt;
          if (r.y > 130) { r.y = -10; r.x = Math.random() * (S.vw + 80); if (Math.random() < 0.14) spawnRipple(r.x, 40 + Math.random() * 50); }
          r.el.style.opacity = '0.55';
          r.el.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
        }
      } else {
        for (const r of rain) r.el.style.opacity = '0';
      }
      // ripples
      for (const rp of ripples) {
        if (!rp.active) continue;
        rp.life += dt;
        const p = rp.life / 1.1;
        if (p >= 1) { rp.active = false; rp.el.style.opacity = '0'; continue; }
        const size = 8 + p * 34;
        rp.el.style.width = rp.el.style.height = size.toFixed(0) + 'px';
        rp.el.style.opacity = (0.6 * (1 - p)).toFixed(2);
        rp.el.style.transform = `translate(${(rp.x - size / 2).toFixed(1)}px, ${(rp.y - size / 2).toFixed(1)}px)`;
      }
      // mist
      const mistOn = w === 'mist';
      for (const m of mists) {
        m.x += m.speed * dt;
        if (m.x > S.vw) m.x = -S.vw * 0.4;
        m.el.style.opacity = mistOn ? '1' : '0';
        m.el.style.transform = `translateX(${m.x.toFixed(1)}px)`;
      }
    }

    // ---- the ship sails the water line, driven by scroll progress ----
    // hidden by CSS on mobile / reduced motion; skip the writes to match
    if (sailerShip && !S.mobile) {
      const prog = Math.min(1, Math.max(0, S.scrollY / S.maxScroll));
      const sx = 10 + prog * (S.vw - 52);
      const bob = Math.sin(S.t * 0.0028) * 3;
      const heel = Math.sin(S.t * 0.0021) * 2.2;
      // The mirror lives in this transform, not a CSS class. A `scaleX(-1)` rule
      // on the inner <svg> would lose to the sail-cycle strip animation, which
      // animates `transform` on that same element.
      sailerShip.style.transform =
        `translate(${sx.toFixed(1)}px, ${bob.toFixed(1)}px) rotate(${heel.toFixed(1)}deg) scaleX(${S.dir < 0 ? -1 : 1})`;
      if (scrolling) { sailerShip.classList.add('sailing'); S.scrolledAt = S.t; }
      else if (S.t - S.scrolledAt > 140) sailerShip.classList.remove('sailing');

      // water drifts; period === background-size, so the wrap is seamless
      if (seaBack)  seaBack.style.backgroundPositionX  = (-(S.t * 0.014) % 80).toFixed(1) + 'px';
      if (seaFront) seaFront.style.backgroundPositionX = (-(S.t * 0.030) % 64).toFixed(1) + 'px';
    }

    // ---- anchor cursor: lerp toward the pointer, swing from the shackle ----
    if (anchorEl && pointerMoved && html.classList.contains('anchor-cursor')) {
      anchor.x += (pointerX - anchor.x) * 0.35;
      anchor.y += (pointerY - anchor.y) * 0.35;
      const lag = pointerX - anchor.x;                       // trailing distance = tilt
      const swing = Math.max(-9, Math.min(9, lag * 0.6)) + Math.sin(S.t * 0.0022) * 3;
      const sq = anchor.down ? 0.82 : 1;
      anchorEl.style.transform =
        `translate(${(anchor.x - 12).toFixed(1)}px, ${(anchor.y - 3).toFixed(1)}px) ` +
        `rotate(${swing.toFixed(1)}deg) scale(${sq})`;
    }

    // ---- cursor trail (always fade so trails dissipate when the pointer stops) ----
    if (bubbles.length) {
      for (const b of bubbles) {
        if (b.life > 0) {
          b.life -= dt * 2;
          b.el.style.opacity = Math.max(0, b.life).toFixed(2);
        }
      }
    }

    S.rafId = requestAnimationFrame(tick);
  }

  function spawnRipple(x, y) {
    const rp = ripples.find(r => !r.active);
    if (!rp) return;
    rp.active = true; rp.life = 0; rp.x = x; rp.y = y;
  }

  function startLoop() {
    if (S.running || !S.motion) return;
    S.running = true;
    S.rafId = requestAnimationFrame(tick);
  }
  function stopLoop() {
    S.running = false;
    cancelAnimationFrame(S.rafId);
  }

  /* ============================================================
     Listeners (passive scroll writes scrollY only)
     ============================================================ */
  window.addEventListener('scroll', () => { S.scrollY = window.scrollY; }, { passive: true });

  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(measure, 150);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else if (S.motion) startLoop();
  });

  if (!mqCoarse.matches) {
    window.addEventListener('pointermove', (e) => {
      pointerX = e.clientX; pointerY = e.clientY;
      if (!pointerMoved) {                      // first move: snap, don't fly in from 0,0
        pointerMoved = true;
        anchor.x = pointerX; anchor.y = pointerY;
        syncAnchor();
      }
      if (!bubbles.length) return;
      const b = bubbles[bubbleIdx = (bubbleIdx + 1) % bubbles.length];
      b.life = 1;
      b.el.style.transform = `translate(${pointerX - 4}px, ${pointerY - 4}px)`;
      b.el.style.opacity = '1';
    }, { passive: true });

    // anchor cursor states: press to squash, hover interactives to light up
    window.addEventListener('pointerdown', () => {
      anchor.down = true; if (anchorEl) anchorEl.classList.add('grab');
    }, { passive: true });
    window.addEventListener('pointerup', () => {
      anchor.down = false; if (anchorEl) anchorEl.classList.remove('grab');
    }, { passive: true });
    document.addEventListener('pointerover', (e) => {
      if (!anchorEl) return;
      const hit = e.target instanceof Element &&
        e.target.closest('a, button, [tabindex], input, textarea, select');
      anchorEl.classList.toggle('over', !!hit);
    }, { passive: true });
    // hide while the pointer is outside the window (pointerleave doesn't bubble,
    // so it must be bound to the root element, not document)
    html.addEventListener('pointerleave', () => {
      if (anchorEl) anchorEl.classList.remove('ready');
    });
    html.addEventListener('pointerenter', () => {
      if (anchorEl && pointerMoved && S.motion) anchorEl.classList.add('ready');
    });
  }

  // unlock audio on first interaction
  ['pointerdown', 'keydown'].forEach(ev =>
    window.addEventListener(ev, () => Sound.unlock(), { once: true }));

  /* ============================================================
     IntersectionObservers
     ============================================================ */
  // reveal
  const revealIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        revealIO.unobserve(e.target);
      }
    }
  }, { threshold: 0.15 });
  $$('.reveal').forEach(el => revealIO.observe(el));

  // hero visibility gate
  const heroIO = new IntersectionObserver((entries) => {
    S.heroVisible = entries[0].isIntersecting;
  }, { threshold: 0.02 });
  const home = $('#home'); if (home) heroIO.observe(home);

  // scroll-spy → nav active + cursor arrow
  const sections = $$('main section[id]');
  const spyIO = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
  }, { rootMargin: '-45% 0px -45% 0px' });
  sections.forEach(s => spyIO.observe(s));

  function setActive(id) {
    let activeLink = null;
    navLinks.forEach(l => {
      const on = l.getAttribute('href') === '#' + id;
      l.classList.toggle('active', on);
      if (on) activeLink = l;
    });
    moveCursor(activeLink);
  }
  function moveCursor(link) {
    if (!link || !navCursor || mqMobile.matches) { if (navCursor) navCursor.classList.remove('show'); return; }
    const x = link.offsetLeft - 18;
    navCursor.style.transform = `translate(${x}px, -50%)`;
    navCursor.classList.add('show');
  }
  // hover preview of cursor
  navLinks.forEach(l => {
    l.addEventListener('mouseenter', () => { moveCursor(l); if (Sound.on) Sound.blip(600, 0.04, 'square', 0.3); });
  });
  navList.addEventListener('mouseleave', () => {
    const active = navLinks.find(l => l.classList.contains('active'));
    moveCursor(active);
  });

  /* ============================================================
     Screen-wipe navigation
     ============================================================ */
  const wipe = $('#wipe');
  function buildWipe() {
    const cols = mqMobile.matches ? 6 : 12;
    const rows = mqMobile.matches ? 4 : 8;
    wipe.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    wipe.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    wipe.innerHTML = '';
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const cell = document.createElement('i');
        cell.style.setProperty('--i', i);
        cell.style.setProperty('--j', j);
        wipe.appendChild(cell);
      }
  }
  buildWipe();
  window.addEventListener('resize', () => { clearTimeout(S._wt); S._wt = setTimeout(buildWipe, 200); });

  let wiping = false;
  function goTo(target) {
    const el = document.querySelector(target);
    if (!el) return;
    if (!S.motion) { el.scrollIntoView(); return; }
    if (wiping) return;
    wiping = true;
    wipe.classList.add('play');
    Sound.click();
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 300);
    setTimeout(() => { wipe.classList.remove('play'); wiping = false; }, 1100);
  }
  $$('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (href.length < 2) return;
      e.preventDefault();
      closeMenu();
      goTo(href);
      history.replaceState(null, '', href);
    });
  });

  /* ============================================================
     Mobile menu
     ============================================================ */
  const hamburger = $('#hamburger');
  function openMenu() { navList.classList.add('open'); hamburger.setAttribute('aria-expanded', 'true'); }
  function closeMenu() { navList.classList.remove('open'); hamburger.setAttribute('aria-expanded', 'false'); }
  hamburger.addEventListener('click', () => {
    navList.classList.contains('open') ? closeMenu() : openMenu();
    Sound.click();
  });

  /* ============================================================
     Typewriter (accessible: full text via aria-label)
     ============================================================ */
  (function typewriter() {
    const typed = $('#typed');
    if (!typed) return;
    const full = typed.dataset.text || typed.textContent.trim();
    const rest = $('.rest', typed);
    const caret = $('.caret', typed);
    typed.setAttribute('aria-label', full);
    if (rest) rest.setAttribute('aria-hidden', 'true');
    if (caret) caret.setAttribute('aria-hidden', 'true');

    if (!S.motion) {                       // reduced: show immediately
      typed.classList.add('done');
      if (rest) rest.style.color = 'inherit';
      return;
    }

    // reserve space with transparent full text, type into an overlay
    const wrap = typed.closest('.type-wrap');
    if (wrap) wrap.style.position = 'relative';
    typed.classList.add('typing');
    if (rest) rest.style.color = 'transparent';
    const tw = document.createElement('span');
    tw.setAttribute('aria-hidden', 'true');
    tw.style.cssText = 'position:absolute; inset:0; color:inherit;';
    typed.insertBefore(tw, rest);

    let started = false, done = false;
    function run() {
      if (started) return; started = true;
      let i = 0;
      const step = () => {
        if (done) return;
        tw.textContent = full.slice(0, i);
        if (caret) tw.appendChild(caret);
        if (i++ <= full.length) setTimeout(step, 22);
        else finish();
      };
      step();
    }
    function finish() {
      done = true;
      tw.textContent = full;
      typed.classList.add('done');
      if (rest) rest.style.color = 'transparent';
    }
    // start when in view; allow skip
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting) { run(); io.disconnect(); }
    }, { threshold: 0.4 });
    io.observe(typed);
    const skip = () => { if (started && !done) finish(); };
    typed.closest('.box').addEventListener('click', skip);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') skip(); });
  })();

  /* ============================================================
     Easter egg — the shell
     ============================================================ */
  (function shell() {
    const sh = $('#shell');
    const toast = $('#toast');
    if (!sh || !toast) return;
    const found = store.get('spp-shell', '') === 'found';
    if (found) sh.classList.add('found');
    sh.addEventListener('click', () => {
      sh.classList.add('found');
      store.set('spp-shell', 'found');
      Sound.fanfare();
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), S.motion ? 4600 : 6000);
    });
  })();

  /* ============================================================
     Set Sail — launch flourish (navigation itself is handled by the
     delegated a[href^="#"] listener above, so don't touch the event)
     ============================================================ */
  (function setSail() {
    const btn = $('#set-sail');
    if (!btn) return;
    // Drop the one-shot entrance class once it has played, so .launch can own
    // `animation` without the entrance re-triggering when .launch is removed.
    const dropEntrance = () => btn.classList.remove('sail-in');
    btn.addEventListener('animationend', (e) => {
      if (e.animationName === 'sail-in') dropEntrance();
    });
    setTimeout(dropEntrance, 1400);     // belt-and-braces: motion may be off
    btn.addEventListener('click', () => {
      if (!S.motion) return;
      dropEntrance();
      btn.classList.remove('launch');
      void btn.offsetWidth;               // restart the animation on repeat clicks
      btn.classList.add('launch');
      setTimeout(() => btn.classList.remove('launch'), 520);
      if (Sound.on) [392, 494, 622].forEach((f, i) =>
        setTimeout(() => Sound.blip(f, 0.09, 'square', 0.45), i * 70));
    });
  })();

  /* ============================================================
     Control buttons
     ============================================================ */
  $('#theme-toggle').addEventListener('click', () => {
    const next = html.getAttribute('data-time') === 'night' ? 'day' : 'night';
    applyTime(next); store.set('spp-time', next); Sound.click();
  });
  $('#sound-toggle').addEventListener('click', (e) => {
    const next = !Sound.on;
    Sound.setOn(next);
    e.currentTarget.setAttribute('aria-pressed', String(next));
    $('#snd-wave').style.opacity = next ? '1' : '0.25';
    if (next) Sound.blip(680, 0.08);
  });
  $('#motion-toggle').addEventListener('click', () => {
    const next = !S.motion;
    applyMotion(next);
    store.set('spp-motion', next ? 'full' : 'reduced');
    Sound.click();
  });

  // react to OS reduced-motion changes if user hasn't overridden
  mqReduce.addEventListener?.('change', () => {
    if (store.get('spp-motion', null) === null) applyMotion(!mqReduce.matches);
  });

  /* ============================================================
     Boot
     ============================================================ */
  applyTime(resolveTime());
  measure();
  applyMotion(resolveMotion());
  // sync sound icon
  $('#snd-wave') && ($('#snd-wave').style.opacity = Sound.on ? '1' : '0.25');
  $('#sound-toggle').setAttribute('aria-pressed', String(Sound.on));

  // re-measure once web fonts settle (Press Start 2P shifts metrics)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      measure();
      const active = navLinks.find(l => l.classList.contains('active')) || navLinks[0];
      moveCursor(active);
    });
  }
  // initial active link
  setActive('home');
})();
