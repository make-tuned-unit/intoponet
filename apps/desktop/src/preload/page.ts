// Sign-in helper for web pages (top frame only, isolated world, no page globals).
// It notices sign-in forms being sent and fills saved ones when main asks.
import { ipcRenderer } from 'electron'
import { passwordPageChannels, type PasswordFillMessage, type PasswordPageMessage } from '../shared/passwordPage'
import { credentialsFrom, fillTargets, identifierFrom, looksLikeSignInButton, type FieldInfo } from './loginForm'

const MAX_INPUTS = 200
const MAX_FORM_REPORTS = 20

const report = (message: PasswordPageMessage): void => ipcRenderer.send(passwordPageChannels.report, message)

function inputsIn(scope: ParentNode): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll('input')).slice(0, MAX_INPUTS)
}

function visible(input: HTMLInputElement): boolean {
  if (input.type === 'hidden' || input.getClientRects().length === 0) return false
  const style = getComputedStyle(input)
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
}

function info(input: HTMLInputElement): FieldInfo {
  const labels = input.labels ? Array.from(input.labels).map((label) => label.textContent ?? '').join(' ') : ''
  return {
    type: (input.getAttribute('type') ?? 'text').toLowerCase(),
    name: input.name,
    id: input.id,
    autocomplete: input.getAttribute('autocomplete') ?? '',
    placeholder: input.placeholder,
    label: `${input.getAttribute('aria-label') ?? ''} ${labels}`.slice(0, 200),
    value: input.value,
    visible: visible(input),
    locked: input.disabled || input.readOnly,
  }
}

/** The form around an element, or the whole page for forms built without a <form>. */
const scopeOf = (element: Element | null): ParentNode => element?.closest('form') ?? document

let lastSent = ''
let lastSentAt = 0

function capture(scope: ParentNode): void {
  const fields = inputsIn(scope).map(info)
  const credentials = credentialsFrom(fields)
  if (!credentials) {
    const username = identifierFrom(fields)
    if (username) report({ type: 'identifier', username })
    return
  }
  const key = `${credentials.username}\n${credentials.password}`
  if (key === lastSent && Date.now() - lastSentAt < 3_000) return
  lastSent = key
  lastSentAt = Date.now()
  report({ type: 'submitted', ...credentials })
}

document.addEventListener('submit', (event) => capture(scopeOf(event.target as Element)), true)

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('button, input[type="submit"], input[type="button"], [role="button"], a') : null
  if (!target) return
  const type = (target.getAttribute('type') ?? '').toLowerCase()
  const form = target.closest('form')
  // A real submit button in a form fires 'submit' anyway.
  if (form && type !== 'button' && (target.tagName === 'BUTTON' || type === 'submit')) return
  const text = (target instanceof HTMLInputElement ? target.value : target.textContent) ?? ''
  if (looksLikeSignInButton(text, type)) capture(scopeOf(target))
}, true)

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
  // Enter in a form fires 'submit'; pages without a form need this.
  if (event.target.form) return
  capture(document)
}, true)

// ---- Telling main a sign-in form is showing --------------------------------------

const reported = new WeakSet<HTMLInputElement>()
let reports = 0
let checkTimer: ReturnType<typeof setTimeout> | null = null

function checkForLoginForm(): void {
  checkTimer = null
  if (reports >= MAX_FORM_REPORTS) return
  const fields = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password" i]')).slice(0, MAX_INPUTS)
  const fresh = fields.find((input) => !reported.has(input) && visible(input))
  if (!fresh) return
  const targets = fillTargets(inputsIn(scopeOf(fresh)).map(info))
  if (!targets) return
  for (const input of fields) if (visible(input)) reported.add(input)
  reports += 1
  report({ type: 'login-form' })
}

const scheduleCheck = (): void => {
  if (!checkTimer) checkTimer = setTimeout(checkForLoginForm, 400)
}

function watch(): void {
  scheduleCheck()
  new MutationObserver(scheduleCheck).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'style', 'class', 'hidden'] })
  document.addEventListener('focusin', (event) => { if (event.target instanceof HTMLInputElement && event.target.type === 'password') scheduleCheck() }, true)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true })
else watch()

// ---- Filling -----------------------------------------------------------------------

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

function put(input: HTMLInputElement, value: string, overwrite: boolean): void {
  if (!overwrite && input.value) return
  if (setValue) setValue.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

ipcRenderer.on(passwordPageChannels.fill, (_event, message: PasswordFillMessage) => {
  if (!message || typeof message.password !== 'string' || typeof message.username !== 'string') return
  // Main checked the origin; check again in case the page moved on meanwhile.
  if (message.origin !== location.origin) return
  const password = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password" i]')).find(visible)
  if (!password) return
  const inputs = inputsIn(scopeOf(password))
  const targets = fillTargets(inputs.map(info))
  if (!targets) return
  if (targets.username !== null && message.username) put(inputs[targets.username]!, message.username, message.overwrite)
  put(inputs[targets.password]!, message.password, message.overwrite)
})
