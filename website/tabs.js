// Tabbed scrollers ([data-tab-scroller]): a tablist over a track of tabpanels.
// Where the track scrolls horizontally (CSS scroll-snap), a tab scrolls its panel into view and
// swiping or trackpad-scrolling selects the matching tab. Where it doesn't (the desktop feature
// panels, which show one panel at a time), a tab simply shows its panel.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function setupScroller(root) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  const track = root.querySelector('.snap-track');
  if (!tabs.length || !track || panels.includes(null)) return null;
  let active = Math.max(0, tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true'));
  let target = null; // the panel a tab is scrolling to; scroll events don't override it meanwhile
  let settle;

  const scrolls = () => track.scrollWidth > track.clientWidth + 1;
  const offset = index => panels[index].offsetLeft - panels[0].offsetLeft;

  function setActive(index, focus = false) {
    const changed = index !== active;
    active = index;
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i].toggleAttribute('aria-hidden', !on);
      panels[i].classList.toggle('is-active', on);
      panels[i].tabIndex = on ? 0 : -1;
    });
    if (focus) tabs[index].focus();
    // Panels shown one at a time replay their entrance animation.
    if (changed && !scrolls()) {
      const panel = panels[index];
      panel.classList.remove('switching');
      if (!reduceMotion.matches) requestAnimationFrame(() => panel.classList.add('switching'));
    }
  }

  function show(index, focus = false) {
    setActive(index, focus);
    if (!scrolls()) return;
    target = index;
    track.scrollTo({ left: offset(index), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    clearTimeout(settle);
    settle = setTimeout(() => { target = null; }, reduceMotion.matches ? 50 : 1000);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => show(index));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); show(next, true); }
    });
  });

  let frame = 0;
  track.addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (target !== null || !scrolls()) return;
      let nearest = 0;
      panels.forEach((panel, i) => {
        if (Math.abs(offset(i) - track.scrollLeft) < Math.abs(offset(nearest) - track.scrollLeft)) nearest = i;
      });
      if (nearest !== active) setActive(nearest);
    });
  }, { passive: true });
  track.addEventListener('scrollend', () => { if (target !== null) { clearTimeout(settle); target = null; } });

  // Keep the active panel aligned when the layout changes (for example crossing the mobile breakpoint).
  addEventListener('resize', () => { if (scrolls()) track.scrollLeft = offset(active); });
  setActive(active);
  return { tabs, show };
}

const scrollers = [...document.querySelectorAll('[data-tab-scroller]')].map(setupScroller).filter(Boolean);

// Links such as "See Laya in the browser" select a feature tab before the page jumps to it.
document.querySelectorAll('[data-jump]').forEach(link => link.addEventListener('click', () => {
  for (const scroller of scrollers) {
    const index = scroller.tabs.findIndex(tab => tab.dataset.feature === link.dataset.jump);
    if (index >= 0) scroller.show(index);
  }
}));
