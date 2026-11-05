// The narrow channel between a web page's sign-in helper (page preload) and main.
// Main never trusts the page for its origin: it reads it from the sending frame.

export const passwordPageChannels = {
  /** Page to main. */
  report: 'intoponet:password-page',
  /** Main to page: fill these values. */
  fill: 'intoponet:password-fill',
} as const

export const USERNAME_LIMIT = 256
export const PASSWORD_LIMIT = 512

export type PasswordPageMessage =
  /** A sign-in form was sent. */
  | { type: 'submitted'; username: string; password: string }
  /** A form with only a username or email was sent (first step of a two-step sign-in). */
  | { type: 'identifier'; username: string }
  /** The page shows a sign-in form. */
  | { type: 'login-form' }

export type PasswordFillMessage = {
  /** The page's own origin when main sent it; the page ignores a fill meant for another origin. */
  origin: string
  username: string
  password: string
  /** false: only fill empty fields (automatic fill on load). */
  overwrite: boolean
}

const text = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.length <= limit && !/[\u0000-\u0008\u000a-\u001f\u007f]/.test(value) ? value : null

export function parsePasswordPageMessage(value: unknown): PasswordPageMessage | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  switch (input['type']) {
    case 'login-form': return { type: 'login-form' }
    case 'identifier': {
      const username = text(input['username'], USERNAME_LIMIT)?.trim()
      return username ? { type: 'identifier', username } : null
    }
    case 'submitted': {
      const username = text(input['username'], USERNAME_LIMIT)
      const password = text(input['password'], PASSWORD_LIMIT)
      if (username === null || !password) return null
      return { type: 'submitted', username: username.trim(), password }
    }
    default: return null
  }
}
