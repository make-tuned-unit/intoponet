// Phone menu: the <details> menu opens and closes on its own; this closes it after a
// link is tapped, on a tap outside it, and on Escape.
(() => {
  const menu = document.querySelector('.nav-menu')
  if (!menu) return
  const close = () => { menu.open = false }
  menu.addEventListener('click', (event) => { if (event.target instanceof Element && event.target.closest('a')) close() })
  document.addEventListener('click', (event) => { if (menu.open && !menu.contains(event.target)) close() })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) { close(); menu.querySelector('summary')?.focus() }
  })
})()
