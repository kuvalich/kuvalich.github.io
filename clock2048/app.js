/* ===== 2048 NEON — shared behaviour ===== */
const PALETTES = [
  { name:'CYAN',   c:['#00E5FF','#FF007F','#DF00FF','#FFD500'] },
  { name:'GREEN',  c:['#39FF14','#0FF0FC','#BFFF00','#FFFFFF'] },
  { name:'SYNTH',  c:['#FF5E00','#9D00FF','#00A2FF','#00FF55'] },
  { name:'INVERT', c:['#FF007F','#00E5FF','#FFFF00','#DF00FF'] },
];

let pIndex = parseInt(localStorage.getItem('p2048') || '0', 10) % PALETTES.length;
function applyPalette(i){
  const p = PALETTES[i].c, r = document.documentElement.style;
  r.setProperty('--primary', p[0]); r.setProperty('--c2', p[1]);
  r.setProperty('--c3', p[2]); r.setProperty('--c4', p[3]);
  localStorage.setItem('p2048', i);
  document.querySelectorAll('.swatch').forEach((s, idx) => s.classList.toggle('active', idx === i));
}
applyPalette(pIndex);

document.addEventListener('DOMContentLoaded', () => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // theme cycle
  const tb = document.querySelector('[data-theme]');
  if (tb) tb.addEventListener('click', () => {
    pIndex = (pIndex + 1) % PALETTES.length; applyPalette(pIndex);
    tb.classList.remove('spin'); void tb.offsetWidth; tb.classList.add('spin');
  });
  document.querySelectorAll('.swatch').forEach((s, idx) =>
    s.addEventListener('click', () => { pIndex = idx; applyPalette(idx); }));

  // mobile nav
  const burger = document.querySelector('.burger');
  if (burger) burger.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  document.querySelectorAll('.nav-links a').forEach(a =>
    a.addEventListener('click', () => document.body.classList.remove('nav-open')));

  // scroll states + progress
  const nav = document.querySelector('.nav');
  const toTop = document.querySelector('.to-top');
  const prog = document.querySelector('.scroll-progress i');
  const onScroll = () => {
    const d = document.documentElement;
    if (nav) nav.classList.toggle('scrolled', d.scrollTop > 18);
    if (toTop) toTop.classList.toggle('show', d.scrollTop > 520);
    if (prog) { const max = d.scrollHeight - d.clientHeight; prog.style.width = (max > 0 ? d.scrollTop / max * 100 : 0) + '%'; }
  };
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
  if (toTop) toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // reveal on scroll
  const io = new IntersectionObserver(es => {
    es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  // count-up stats
  const cio = new IntersectionObserver(es => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target, target = +el.dataset.count, t0 = performance.now(), dur = 1500;
      const step = now => {
        const p = Math.min(1, (now - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step); cio.unobserve(el);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('.stat b[data-count]').forEach(el => cio.observe(el));

  // footer year
  const yr = document.getElementById('yr'); if (yr) yr.textContent = new Date().getFullYear();

  // spotlight + hero parallax
  const floatTiles = document.querySelector('.float-tiles');
  if (!reduce) window.addEventListener('pointermove', e => {
    document.documentElement.style.setProperty('--mx', e.clientX + 'px');
    document.documentElement.style.setProperty('--my', e.clientY + 'px');
    if (floatTiles) {
      const fx = (e.clientX / innerWidth - .5), fy = (e.clientY / innerHeight - .5);
      floatTiles.style.transform = `translate(${fx * 26}px, ${fy * 26}px)`;
    }
  }, { passive: true });

  // 3D tilt
  if (!reduce) document.querySelectorAll('[data-tilt]').forEach(el => {
    el.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
      el.style.transform = `perspective(740px) rotateX(${-py * 8}deg) rotateY(${px * 10}deg) translateY(-6px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });

  // magnetic buttons
  if (!reduce) document.querySelectorAll('.btn[data-mag]').forEach(b => {
    b.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const r = b.getBoundingClientRect();
      b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .25}px, ${(e.clientY - r.top - r.height / 2) * .35}px)`;
    });
    b.addEventListener('pointerleave', () => { b.style.transform = ''; });
  });

  initGame();
});

/* ===== Playable 2048 ===== */
function initGame(){
  const board = document.getElementById('board');
  if (!board) return;
  const layer = document.getElementById('tiles');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const over = document.getElementById('gover');
  const overTitle = document.getElementById('gotitle');
  const overMsg = document.getElementById('gomsg');
  const N = 4, GAP = 12, PAD = 14;
  const LIMIT = 5;
  let tiles = [], score = 0, best = +(localStorage.getItem('best2048') || 0), uid = 0, won = false, busy = false, cell = 0, moves = 0, locked = false;
  bestEl.textContent = best;

  const xy = (r, c) => `translate(${c * (cell + GAP)}px, ${r * (cell + GAP)}px)`;
  function measure(){
    const inner = board.clientWidth - PAD * 2;
    cell = (inner - GAP * (N - 1)) / N;
    tiles.forEach(t => { t.el.style.width = cell + 'px'; t.el.style.height = cell + 'px'; t.el.style.transform = xy(t.r, t.c); });
  }
  function tileAt(r, c){ return tiles.find(t => t.r === r && t.c === c); }
  function inB(r, c){ return r >= 0 && r < N && c >= 0 && c < N; }
  function emptyCells(){ const e = []; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!tileAt(r, c)) e.push([r, c]); return e; }
  function makeTile(r, c, val, spawn){
    const el = document.createElement('div');
    el.className = 'tile t' + val + (spawn ? ' spawn' : '');
    el.style.width = cell + 'px'; el.style.height = cell + 'px'; el.style.transform = xy(r, c);
    const inner = document.createElement('div'); inner.className = 'tinner'; inner.textContent = val;
    el.appendChild(inner); layer.appendChild(el);
    if (spawn) setTimeout(() => el.classList.remove('spawn'), 210);
    return { id: ++uid, r, c, val, el };
  }
  function place(t, r, c){ t.r = r; t.c = c; t.el.style.transform = xy(r, c); }
  function setScore(add){ score += add; scoreEl.textContent = score; if (score > best){ best = score; bestEl.textContent = best; localStorage.setItem('best2048', best); } }
  function spawn(){ const e = emptyCells(); if (!e.length) return; const [r, c] = e[(Math.random() * e.length) | 0]; tiles.push(makeTile(r, c, Math.random() < 0.9 ? 2 : 4, true)); }
  function reset(){ layer.innerHTML = ''; tiles = []; score = 0; won = false; busy = false; moves = 0; locked = false; scoreEl.textContent = '0'; over.classList.remove('show'); measure(); spawn(); spawn(); }
  function showOver(title, msg){ overTitle.textContent = title; if (overMsg) overMsg.textContent = msg || ''; over.classList.add('show'); }
  function movesAvailable(){
    if (emptyCells().length) return true;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++){ const t = tileAt(r, c); if (!t) continue; const a = tileAt(r, c + 1), b = tileAt(r + 1, c); if ((a && a.val === t.val) || (b && b.val === t.val)) return true; }
    return false;
  }
  function move(dir){
    if (busy || locked) return;
    const vec = { left:[0,-1], right:[0,1], up:[-1,0], down:[1,0] }[dir];
    const rs = [0,1,2,3], cs = [0,1,2,3];
    if (vec[0] === 1) rs.reverse();
    if (vec[1] === 1) cs.reverse();
    let moved = false; const merges = [];
    tiles.forEach(t => t.merged = false);
    rs.forEach(r => cs.forEach(c => {
      const tile = tileAt(r, c); if (!tile) return;
      let nr = r, nc = c, next;
      do { nr += vec[0]; nc += vec[1]; next = tileAt(nr, nc); } while (inB(nr, nc) && !next);
      const fr = nr - vec[0], fc = nc - vec[1];
      if (next && next.val === tile.val && !next.merged){
        next.merged = true; place(tile, next.r, next.c); moved = true;
        merges.push({ keep: next, gone: tile, val: tile.val * 2 });
      } else if (fr !== r || fc !== c){ place(tile, fr, fc); moved = true; }
    }));
    if (!moved) return;
    busy = true; moves++;
    setTimeout(() => {
      merges.forEach(m => {
        m.gone.el.remove(); tiles = tiles.filter(t => t !== m.gone);
        m.keep.val = m.val; m.keep.el.className = 'tile t' + m.val + ' merge';
        m.keep.el.querySelector('.tinner').textContent = m.val;
        setTimeout(() => m.keep.el.classList.remove('merge'), 220);
        setScore(m.val);
        if (m.val === 2048 && !won){ won = true; showOver('YOU WIN!', 'Get the full app for endless neon play.'); }
      });
      spawn();
      busy = false;
      if (won) return;
      if (moves >= LIMIT){ locked = true; showOver('PREVIEW OVER', 'You\u2019ve reached the 5-move preview limit \u2014 download the app to keep playing!'); return; }
      if (!movesAvailable()) showOver('GAME OVER', 'Out of moves! Download the app for the full experience.');
    }, 130);
  }

  // controls
  window.addEventListener('keydown', e => {
    const map = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right', w:'up', a:'left', s:'down', d:'right', W:'up', A:'left', S:'down', D:'right' };
    const dir = map[e.key]; if (!dir) return;
    const r = board.getBoundingClientRect();
    if (r.bottom < innerHeight * 0.12 || r.top > innerHeight * 0.88) return;
    e.preventDefault(); move(dir);
  });
  let sx = null, sy = null;
  board.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  board.addEventListener('touchend', e => {
    if (sx == null) return; const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 24) move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    sx = sy = null;
  });
  const ng = document.getElementById('newgame'); if (ng) ng.addEventListener('click', reset);
  const rt = document.getElementById('goretry'); if (rt) rt.addEventListener('click', reset);
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  reset();
}
