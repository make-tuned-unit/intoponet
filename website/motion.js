const preference = matchMedia('(prefers-reduced-motion: reduce)');
const motionButton = document.querySelector('.motion-toggle');
let paused = preference.matches;
let frame = 0;
let time = 0;
let visible = true;
const canvas = document.querySelector('#terrain');
const ctx = canvas.getContext('2d');
let width = 0, height = 0;
const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
function resize() {
  const bounds = canvas.getBoundingClientRect();
  width = bounds.width; height = bounds.height;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = width * ratio; canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw();
}
function draw() {
  ctx.clearRect(0, 0, width, height);
  const scale = width / 900;
  ctx.save();
  ctx.translate(width * .5 + pointer.x * 12, height * .53 + pointer.y * 8);
  ctx.scale(scale, scale);
  // A projected field of fluid contours: illustrative, never presented as data.
  for (let row = 0; row < 62; row++) {
    const z = row / 61;
    ctx.beginPath();
    for (let col = 0; col <= 140; col++) {
      const x = col / 140 * 1050 - 525;
      const ridge = 155 * Math.exp(-((x + 95) ** 2) / 24000 - ((z - .49) ** 2) / .045)
        + 110 * Math.exp(-((x - 260) ** 2) / 19000 - ((z - .69) ** 2) / .04)
        + 70 * Math.exp(-((x + 320) ** 2) / 13000 - ((z - .25) ** 2) / .03);
      const wave = Math.sin(x / 115 + z * 8 + time * .35) * 8 + Math.cos(x / 170 - time * .22) * 5;
      const px = x * (.62 + z * .38) + (z - .5) * 110;
      const py = (z - .5) * 420 - ridge + wave;
      if (col === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = row % 6 === 0 ? 'rgba(130,235,218,.65)' : `rgba(80,217,199,${.12 + z * .2})`;
    ctx.lineWidth = row % 6 === 0 ? 1.3 : .7;
    ctx.stroke();
  }
  ctx.restore();
}
let previous = 0;
function tick(now) {
  frame = 0;
  if (paused || !visible || document.hidden) return;
  if (now - previous >= 32) {
    time += Math.min((now - previous) / 1000, .05);
    previous = now;
    pointer.x += (pointer.targetX - pointer.x) * .04;
    pointer.y += (pointer.targetY - pointer.y) * .04;
    draw();
  }
  frame = requestAnimationFrame(tick);
}
function start() { if (!frame && !paused && visible && !document.hidden) { previous = performance.now(); frame = requestAnimationFrame(tick); } }
function syncMotion() {
  document.documentElement.classList.toggle('motion-paused', paused);
  motionButton.setAttribute('aria-pressed', String(paused));
  motionButton.textContent = paused ? 'Play motion ▷' : 'Pause motion Ⅱ';
  cancelAnimationFrame(frame); frame = 0;
  start();
}
motionButton.addEventListener('click', () => { paused = !paused; syncMotion(); });
preference.addEventListener('change', event => { paused = event.matches; syncMotion(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else start(); });
new ResizeObserver(resize).observe(canvas);
new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) start(); else { cancelAnimationFrame(frame); frame = 0; } }).observe(canvas);
document.querySelector('.hero').addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || paused) return;
  const box = canvas.getBoundingClientRect();
  pointer.targetX = (event.clientX - box.left) / box.width - .5;
  pointer.targetY = (event.clientY - box.top) / box.height - .5;
});
document.querySelector('.hero').addEventListener('pointerleave', () => { pointer.targetX = 0; pointer.targetY = 0; });
const revealObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('revealed'); revealObserver.unobserve(entry.target); }
}, { threshold: .08 });
document.querySelectorAll('.section-intro,.browser-shot,.features article,.privacy>div,.vision h2,.roadmap>div,.download,.perspective-heading,.perspective-bottom').forEach(el => { el.classList.add('reveal'); revealObserver.observe(el); });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  const linear = button.dataset.view === 'linear';
  document.querySelector('.discovery-stage').dataset.mode = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  document.querySelector('.demo-caption').textContent = linear
    ? 'A list gives you a sequence. One item follows another, while the connections between them stay out of view.'
    : 'A landscape makes room for relationships. Choose a direction, explore the context, and discover what lies nearby.';
}));
resize(); syncMotion();
