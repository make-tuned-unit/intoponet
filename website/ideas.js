// intoponet.com/ideas: sends the form to /api/ideas (the page's policy allows no form posts,
// only requests to this site). Nothing is stored in the browser.
(() => {
  const form = document.getElementById('idea-form')
  if (!form) return
  const opened = Date.now()
  const text = form.querySelector('#idea-text')
  const count = form.querySelector('#idea-count')
  const status = form.querySelector('#idea-status')
  const button = form.querySelector('.ideas-submit')
  const say = (message, kind) => {
    status.textContent = message
    status.classList.toggle('is-error', kind === 'error')
    status.classList.toggle('is-done', kind === 'done')
  }
  const update = () => {
    count.textContent = `${text.value.length} / 3000`
    button.disabled = text.value.trim().length < 10
  }
  text.addEventListener('input', update)
  update()

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (button.disabled) return
    const data = new FormData(form)
    button.disabled = true
    say('Sending…')
    try {
      const response = await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          area: data.get('area'),
          idea: data.get('idea'),
          name: data.get('name'),
          email: data.get('email'),
          website: data.get('website'),
          elapsedMs: Date.now() - opened,
        }),
      })
      if (response.ok) {
        form.reset()
        update()
        say('Thank you. Your idea is on its way to the team.', 'done')
        return
      }
      const body = await response.json().catch(() => ({}))
      say(body.error || 'Your idea could not be sent. Please try again.', 'error')
    } catch {
      say('Your idea could not be sent. Check your connection and try again.', 'error')
    }
    update()
  })
})()
