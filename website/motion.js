// Ambient motion is CSS-only (the hero artwork's slow drift and small illustration loops).
// It follows the visitor's reduced-motion setting and pauses while the tab is hidden.
const preference = matchMedia('(prefers-reduced-motion: reduce)');
let paused = preference.matches;
function syncMotion() { document.documentElement.classList.toggle('motion-paused', paused); }
preference.addEventListener('change', event => { paused = event.matches; syncMotion(); });
document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('page-hidden', document.hidden);
});
// Content is never hidden waiting for a scroll: sections are visible as soon as they are reached.
const sceneObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => entry.target.classList.toggle('in-view', entry.isIntersecting));
}, { threshold: .1 });
document.querySelectorAll('.discovery-demo,.privacy,.hero').forEach(el => sceneObserver.observe(el));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  const linear = button.dataset.view === 'linear';
  document.querySelector('.discovery-stage').dataset.mode = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  document.querySelector('.demo-caption').textContent = linear
    ? 'A list gives you a sequence. One item follows another, while the connections between them stay out of view.'
    : 'A landscape makes room for relationships. Choose a direction, explore the context, and discover what lies nearby.';
}));
syncMotion();
