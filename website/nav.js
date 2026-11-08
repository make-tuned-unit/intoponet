// Header: the phone menu, the header turning opaque once the page scrolls, the link for the
// section in view marked, and "Send this page to your Mac" for phone visitors.
(() => {
  const menu = document.querySelector('.nav-menu')
  if (menu) {
    const close = () => { menu.open = false }
    menu.addEventListener('click', (event) => { if (event.target instanceof Element && event.target.closest('a')) close() })
    document.addEventListener('click', (event) => { if (menu.open && !menu.contains(event.target)) close() })
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.open) { close(); menu.querySelector('summary')?.focus() }
    })
  }

  const header = document.querySelector('header')
  // Each header link stands for its section and the ones after it, up to the next link's section.
  const links = [...document.querySelectorAll('header nav > a[href^="#"]')]
  const marks = links.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean)
  let queued = false
  const update = () => {
    queued = false
    header?.classList.toggle('is-scrolled', scrollY > 8)
    const line = innerHeight * 0.3
    let current = -1
    marks.forEach((section, index) => { if (section.getBoundingClientRect().top <= line) current = index })
    // Past the questions (the download panel and footer), nothing is marked.
    const last = marks[marks.length - 1]
    if (last && last.getBoundingClientRect().bottom < line) current = -1
    links.forEach((link, index) => {
      if (index === current) link.setAttribute('aria-current', 'true')
      else link.removeAttribute('aria-current')
    })
  }
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update) } }, { passive: true })
  addEventListener('resize', update)
  update()

  // Phones can't install a Mac app: offer to send the page on (share sheet, or copy the link).
  for (const button of document.querySelectorAll('[data-share]')) {
    button.addEventListener('click', async () => {
      const url = 'https://intoponet.com/'
      try {
        if (navigator.share) {
          await navigator.share({ title: 'intoponet', text: 'A browser that opens on the whole world. Download it for Mac.', url })
          return
        }
        await navigator.clipboard.writeText(url)
        button.textContent = 'Link copied. Open it on your Mac.'
      } catch (error) {
        // Dismissing the share sheet is not a failure; anything else shows the address to copy.
        if (error?.name !== 'AbortError') button.textContent = url
      }
    })
  }
})()
