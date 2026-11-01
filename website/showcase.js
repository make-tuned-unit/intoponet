// "See the browser": tabs over a horizontal scroll-snap track of app captures.
// A tab scrolls its shot into view; swiping or trackpad-scrolling the track selects the matching tab.
const tablist = document.querySelector('.showcase-tabs');
const track = document.querySelector('.shot-track');
if (tablist && track) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = 0;
  let target = null; // the shot a tab click is scrolling to; scroll events don't override it meanwhile
  let settle;

  function setActive(index, focus = false) {
    active = index;
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i].toggleAttribute('aria-hidden', !on);
      panels[i].classList.toggle('is-active', on);
    });
    if (focus) tabs[index].focus();
  }

  function show(index, focus = false) {
    setActive(index, focus);
    target = index;
    const left = panels[index].offsetLeft - panels[0].offsetLeft;
    track.scrollTo({ left, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
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
      if (target !== null) return;
      const origin = panels[0].offsetLeft;
      let nearest = 0;
      panels.forEach((panel, i) => {
        if (Math.abs(panel.offsetLeft - origin - track.scrollLeft) < Math.abs(panels[nearest].offsetLeft - origin - track.scrollLeft)) nearest = i;
      });
      if (nearest !== active) setActive(nearest);
    });
  }, { passive: true });

  track.addEventListener('scrollend', () => { if (target !== null) { clearTimeout(settle); target = null; } });

  // Keep the active shot aligned when the layout width changes.
  addEventListener('resize', () => { track.scrollLeft = panels[active].offsetLeft - panels[0].offsetLeft; });
  setActive(0);
}
