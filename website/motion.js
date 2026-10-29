const preference = matchMedia('(prefers-reduced-motion: reduce)');
const motionButton = document.querySelector('.motion-toggle');
let paused = preference.matches;
let frame = 0, time = 0, previous = 0, visible = true;
let signal = 1, targetSignal = 1;
const canvas = document.querySelector('#terrain');
const globe = window.createIntoponetGlobe?.(canvas);
const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
function tick(now) {
  frame = 0;
  if (paused || !visible || document.hidden) return;
  if (now - previous >= 32) {
    const dt = Math.min((now - previous) / 1000, .05);
    time += dt; previous = now;
    pointer.x += (pointer.targetX - pointer.x) * .06;
    pointer.y += (pointer.targetY - pointer.y) * .06;
    signal += (targetSignal - signal) * .09;
    globe?.draw(time, pointer.x, pointer.y, signal);
  }
  frame = requestAnimationFrame(tick);
}
function start() { if (globe && !frame && !paused && visible && !document.hidden) { previous = performance.now(); frame = requestAnimationFrame(tick); } }
function syncMotion() {
  document.documentElement.classList.toggle('motion-paused', paused);
  motionButton.setAttribute('aria-pressed', String(paused));
  motionButton.textContent = paused ? 'Play motion ▷' : 'Pause motion Ⅱ';
  cancelAnimationFrame(frame); frame = 0; start();
}
motionButton.addEventListener('click', () => { paused = !paused; syncMotion(); });
preference.addEventListener('change', event => { paused = event.matches; syncMotion(); });
document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('page-hidden', document.hidden);
  if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else start();
});
new IntersectionObserver(entries => {
  visible = entries[0].isIntersecting;
  if (visible) start(); else { cancelAnimationFrame(frame); frame = 0; }
}).observe(canvas);
document.querySelector('.world-scene').addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || paused) return;
  const box = canvas.getBoundingClientRect();
  pointer.targetX = (event.clientX - box.left) / box.width - .5;
  pointer.targetY = (event.clientY - box.top) / box.height - .5;
});
document.querySelector('.world-scene').addEventListener('pointerleave', () => { pointer.targetX = 0; pointer.targetY = 0; });
document.querySelectorAll('[data-globe]').forEach(button => button.addEventListener('click', () => {
  targetSignal = button.dataset.globe === 'signals' ? 1 : 0;
  document.querySelectorAll('[data-globe]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  document.querySelector('.world-scene').classList.toggle('night-mode', !targetSignal);
  if (paused) { signal = targetSignal; globe?.draw(time, pointer.x, pointer.y, signal); }
}));
const revealObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('revealed'); revealObserver.unobserve(entry.target); }
}, { threshold: .08 });
document.querySelectorAll('.section-intro,.feature-story,.privacy>div,.vision h2,.roadmap>div,.download,.perspective-heading,.perspective-bottom,.depth-heading,.detail-card').forEach(el => { el.classList.add('reveal'); revealObserver.observe(el); });
const sceneObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => entry.target.classList.toggle('in-view', entry.isIntersecting));
}, { threshold: .1 });
document.querySelectorAll('.detail-card,.discovery-demo,.privacy,.world-scene').forEach(el => sceneObserver.observe(el));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  const linear = button.dataset.view === 'linear';
  document.querySelector('.discovery-stage').dataset.mode = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  document.querySelector('.demo-caption').textContent = linear
    ? 'A list gives you a sequence. One item follows another, while the connections between them stay out of view.'
    : 'A landscape makes room for relationships. Choose a direction, explore the context, and discover what lies nearby.';
}));
const features = {
  explore: {kicker:'A WORLD YOU CAN WANDER', title:'Start anywhere.\nSee where it takes you.', description:'Fly from Earth to a place that catches your curiosity. Explore public news and natural events, then open the real websites behind them.', image:'browser', alt:'Earth with geographic highlights and public source layers.', caption:'Actual prototype capture. Source coverage is partial; attention is not a measure of truth.'},
  momentum: {kicker:'FOLLOW THE CHANGE', title:'What’s rising?\nWhat’s fading?', description:'Move beyond a static ranking. RSS reporting and readership signals help reveal what is gaining attention and what is becoming quieter, across places and sources.', image:'momentum', alt:'The Rising view with worldwide news terms and readership changes.', caption:'Actual prototype capture, not live data. News refreshes periodically; coverage trends compare rolling 24-hour windows.'},
  history: {kicker:'THE HISTORY BEHIND THE NEWS', title:'Today is only\npart of the story.', description:'The Olds traces earlier events and sourced background. Switch between story, timeline and list views, follow the references, and see where the evidence remains limited.', image:'history', alt:'The Olds timeline with historical background, source labels and uncertainty for an election story.', caption:'Actual prototype capture. Selected historical context is not a complete history or proof of causation.'},
  knowledge: {kicker:'YOUR LIBRARY. LOCAL INTELLIGENCE.', title:'Keep the page.\nFind the connection.', description:'Absorb pages into your private library. Laya helps you retrieve related passages and search by meaning, with citations back to what you saved. Optional, with processing on your device.', image:'knowledge', alt:'Laya finding cited passages about auroras in a saved local knowledge library.', caption:'Actual prototype capture. Laya is optional; source-linked passages come from the user’s saved pages.'},
  beacon: {kicker:'A DELIBERATE ACT OF DISCOVERY', title:'Found something good?\nLeave a light on.', description:'A Beacon recommends a page to the public field. Preview exactly what will be shared and choose to publish. Your private library and browsing history stay out of the contribution.', image:'beacon', alt:'Beacon consent preview showing the public page details and private information excluded from sharing.', caption:'Actual private-beta prototype. Publishing is explicit; public Beacon safeguards are still being developed.'}
};
const tabs = [...document.querySelectorAll('[data-feature]')];
function selectFeature(key, focus = false) {
  const feature = features[key]; if (!feature) return;
  tabs.forEach(tab => { const active = tab.dataset.feature === key; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; if (active && focus) tab.focus(); });
  const panel = document.querySelector('#feature-panel');
  panel.setAttribute('aria-labelledby', `tab-${key}`);
  document.querySelector('#feature-kicker').textContent = feature.kicker;
  document.querySelector('#feature-title').textContent = feature.title;
  document.querySelector('#feature-description').textContent = feature.description;
  document.querySelector('#window-title').textContent = `intoponet / ${key}`;
  document.querySelector('#feature-caption').textContent = feature.caption;
  const img = document.querySelector('#feature-image');
  img.src = `/assets/${feature.image}.jpg`; img.alt = feature.alt;
  panel.dataset.feature = key;
  panel.classList.remove('switching');
  if (!paused) requestAnimationFrame(() => panel.classList.add('switching'));
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectFeature(tab.dataset.feature));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); selectFeature(tabs[next].dataset.feature, true); }
  });
});
document.querySelectorAll('[data-jump]').forEach(link => link.addEventListener('click', () => selectFeature(link.dataset.jump)));
syncMotion();
