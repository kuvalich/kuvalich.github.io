// Live animated spirograph (hypotrochoid) drawn into the phone mockup canvas.
// Purely decorative; mirrors the app's neon-on-dark aesthetic.
(function () {
  const canvas = document.getElementById('spiroCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const palette = ['#9E8CFF', '#67E8F9', '#FF6FA5', '#5B4BFF', '#00B4D8', '#30D158'];

  let W, H, cx, cy, scale, dpr;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2;
    scale = Math.min(W, H) * 0.4;
  }
  resize();
  window.addEventListener('resize', resize);

  // Hypotrochoid parameters (cycle through pleasing combos)
  const presets = [
    { R: 1.0, r: 0.33, d: 0.62 },
    { R: 1.0, r: 0.28, d: 0.7 },
    { R: 1.0, r: 0.4, d: 0.55 },
    { R: 1.0, r: 0.21, d: 0.78 },
  ];
  let pi = 0;
  let t = 0;            // current drawn parameter
  const speed = 0.06;   // radians per frame
  let colorPhase = 0;

  function point(p, a) {
    const k = p.r;
    const x = (p.R - k) * Math.cos(a) + p.d * k * Math.cos(((p.R - k) / k) * a);
    const y = (p.R - k) * Math.sin(a) - p.d * k * Math.sin(((p.R - k) / k) * a);
    return [cx + x * scale, cy + y * scale];
  }

  // Number of revolutions before the curve closes
  function periods(p) {
    // denominator of r as a fraction -> revolutions; approximate with 1/r
    return Math.PI * 2 * 14;
  }

  function frame() {
    const p = presets[pi];
    const maxT = periods(p);

    // Fade the previous frame slightly for a glowing trail, then redraw path up to t
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(8,8,14,0.16)';
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const grad = ctx.createLinearGradient(0, 0, W, H);
    const c1 = palette[Math.floor(colorPhase) % palette.length];
    const c2 = palette[(Math.floor(colorPhase) + 2) % palette.length];
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.strokeStyle = grad;
    ctx.shadowBlur = 12;
    ctx.shadowColor = c1;

    const step = 0.05;
    const start = Math.max(0, t - 0.9);
    ctx.beginPath();
    let first = true;
    for (let a = start; a <= t; a += step) {
      const [x, y] = point(p, a);
      if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    // Leading pen dot
    const [px, py] = point(p, t);
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(px, py, 2.4, 0, Math.PI * 2);
    ctx.fill();

    t += speed;
    colorPhase += 0.004;
    if (t > maxT) {
      t = 0;
      pi = (pi + 1) % presets.length;
      // soft clear on pattern change
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(8,8,14,0.5)';
      ctx.fillRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }

  if (reduce) {
    // Draw a single static full curve
    const p = presets[0];
    ctx.fillStyle = '#08080e'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#9E8CFF'; ctx.lineWidth = 1.4; ctx.shadowBlur = 8; ctx.shadowColor = '#67E8F9';
    ctx.beginPath();
    let first = true;
    for (let a = 0; a <= periods(p); a += 0.05) {
      const [x, y] = point(p, a);
      if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = '#08080e'; ctx.fillRect(0, 0, W, H);
    requestAnimationFrame(frame);
  }
})();
