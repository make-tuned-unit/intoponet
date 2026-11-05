// Which fields of a form are a sign-in: plain data in, plain data out, so it can be tested without a browser.

export type FieldInfo = {
  /** Lower-case input type ('text', 'email', 'password', 'hidden'…). */
  type: string
  name: string
  id: string
  autocomplete: string
  placeholder: string
  /** aria-label and the text of its <label>. */
  label: string
  value: string
  visible: boolean
  /** Disabled or read-only. */
  locked: boolean
}

const USERNAME_TYPES = new Set(['text', 'email', 'tel', ''])

/** Name, id, placeholder and label as lower-case words ("cardNumber" → "card number"). */
const hint = (field: FieldInfo): string =>
  [field.name, field.id, field.placeholder, field.label]
    .join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_\-.[\]]+/g, ' ')

const SECRET_NOT_PASSWORD = /\b(otp|one ?time|2fa|mfa|totp|verification|verify|security code|sms|cvv|cvc|csc|card|pin|token|code)\b/

/** One-time codes, card numbers, card security codes and PINs are never captured or filled. */
export function isCodeOrCard(field: FieldInfo): boolean {
  const auto = field.autocomplete.toLowerCase()
  if (auto.includes('one-time-code') || /\bcc-/.test(auto)) return true
  return SECRET_NOT_PASSWORD.test(hint(field))
}

export function isPasswordField(field: FieldInfo): boolean {
  return field.type === 'password' && !field.locked && !isCodeOrCard(field)
}

const isNewPassword = (field: FieldInfo): boolean => /\bnew-password\b/.test(field.autocomplete.toLowerCase())

function isUsernameField(field: FieldInfo): boolean {
  if (field.locked || isCodeOrCard(field)) return false
  const auto = field.autocomplete.toLowerCase()
  if (/\b(username|email)\b/.test(auto)) return field.visible || field.type === 'hidden'
  if (!field.visible || !USERNAME_TYPES.has(field.type)) return false
  return !/\b(search|query|q)\b/.test(hint(field)) && !/\bsearch\b/.test(auto)
}

/** Rank a username candidate: declared usernames first, then email fields. */
const usernameRank = (field: FieldInfo): number => {
  const auto = field.autocomplete.toLowerCase()
  if (/\busername\b/.test(auto)) return 3
  if (/\bemail\b/.test(auto) || field.type === 'email') return 2
  if (/\b(user|login|email|account|identifier|id)\b/.test(hint(field))) return 1
  return 0
}

function pickUsername(fields: FieldInfo[], before: number, needValue: boolean): number | null {
  let best: number | null = null
  let bestRank = -1
  // The closest field before the password wins among equals.
  for (let index = 0; index < before; index += 1) {
    const field = fields[index]!
    if (!isUsernameField(field) || (needValue && !field.value.trim())) continue
    const rank = usernameRank(field)
    if (rank >= bestRank) {
      best = index
      bestRank = rank
    }
  }
  if (best !== null) return best
  // Some pages keep the username in a hidden field (autocomplete="username"), anywhere in the form.
  const hidden = fields.findIndex((field) => field.type === 'hidden' && /\busername\b/.test(field.autocomplete.toLowerCase()) && (!needValue || field.value.trim()))
  return hidden >= 0 ? hidden : null
}

/** The username and password a sent form holds, or null when it is not a sign-in. */
export function credentialsFrom(fields: FieldInfo[]): { username: string; password: string } | null {
  const secrets = fields.map((field, index) => ({ field, index })).filter(({ field }) => isPasswordField(field) && field.value)
  if (!secrets.length) return null
  let chosen = secrets[0]!
  const fresh = secrets.find(({ field }) => isNewPassword(field))
  if (fresh) chosen = fresh
  else if (secrets.length >= 2) {
    // Sign-up (new, confirm) or change (current, new, confirm): keep the new one.
    const [a, b] = secrets.slice(-2)
    chosen = a!.field.value === b!.field.value ? b! : secrets[1]!
  }
  const usernameAt = pickUsername(fields, secrets[0]!.index, true)
  return { username: usernameAt === null ? '' : fields[usernameAt]!.value.trim(), password: chosen.field.value }
}

/** The username on the first page of a two-step sign-in (no password field yet). */
export function identifierFrom(fields: FieldInfo[]): string | null {
  if (fields.some((field) => field.type === 'password')) return null
  const candidates = fields.filter((field) => isUsernameField(field) && field.visible && field.value.trim())
  if (candidates.length !== 1) return null
  const [field] = candidates
  return usernameRank(field!) > 0 ? field!.value.trim() : null
}

/** Where to fill a saved sign-in: the first visible password field that is not for a new password. */
export function fillTargets(fields: FieldInfo[]): { username: number | null; password: number } | null {
  const password = fields.findIndex((field) => isPasswordField(field) && field.visible && !isNewPassword(field))
  if (password < 0) return null
  return { username: pickUsername(fields, password, false), password }
}

/** A button or link that probably sends a sign-in (for pages that never fire a submit event). */
export function looksLikeSignInButton(text: string, type: string): boolean {
  if (type === 'submit') return true
  return /^\s*(sign ?in|log ?in|log on|continue|next|submit|enter|go)\b/i.test(text.slice(0, 60))
}
