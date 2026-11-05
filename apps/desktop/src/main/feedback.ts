import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Asking for feedback once people have used the app for a while. Only active time counts (the
 * window in front and the Mac in use). The prompt comes after an hour, comes back at most twice
 * after "Not now" (each time after three more hours), and never again once sent or declined.
 * What is sent is only what the person writes, their rating and the app version.
 */

export const FIRST_ASK_MS = 60 * 60_000
export const ASK_AGAIN_MS = 3 * 60 * 60_000
export const MAX_ASKS = 3
export const FEEDBACK_URL = 'https://intoponet.com/api/feedback'
const COMMENT_LIMIT = 2_000

export type FeedbackState = {
  activeMs: number
  /** Active time at each "Not now". */
  laterAt: number[]
  sentAt: string | null
  declined: boolean
}

export type FeedbackCommand =
  | { kind: 'status' }
  | { kind: 'later' }
  | { kind: 'never' }
  | { kind: 'send'; rating: number | null; comment: string }

const empty = (): FeedbackState => ({ activeMs: 0, laterAt: [], sentAt: null, declined: false })

export function feedbackDue(state: FeedbackState): boolean {
  if (state.sentAt || state.declined || state.laterAt.length >= MAX_ASKS) return false
  const last = state.laterAt.at(-1)
  return last === undefined ? state.activeMs >= FIRST_ASK_MS : state.activeMs - last >= ASK_AGAIN_MS
}

export function parseFeedbackCommand(value: unknown): FeedbackCommand {
  const input = value as Record<string, unknown> | null
  switch (input?.['kind']) {
    case 'status': return { kind: 'status' }
    case 'later': return { kind: 'later' }
    case 'never': return { kind: 'never' }
    case 'send': {
      const rating = input['rating']
      const comment = typeof input['comment'] === 'string' ? input['comment'].slice(0, COMMENT_LIMIT) : ''
      const stars = typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null
      if (stars === null && !comment.trim()) throw new Error('A rating or a comment is needed.')
      return { kind: 'send', rating: stars, comment }
    }
    default: throw new Error('Invalid feedback command.')
  }
}

export class FeedbackService {
  private state: FeedbackState | null = null
  private saving = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly version: string,
    private readonly post: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
  ) {}

  private async load(): Promise<FeedbackState> {
    if (this.state) return this.state
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<FeedbackState>
      this.state = {
        activeMs: Number.isFinite(raw.activeMs) ? Math.max(0, raw.activeMs!) : 0,
        laterAt: Array.isArray(raw.laterAt) ? raw.laterAt.filter((n): n is number => Number.isFinite(n)) : [],
        sentAt: typeof raw.sentAt === 'string' ? raw.sentAt : null,
        declined: raw.declined === true,
      }
    } catch {
      this.state = empty()
    }
    return this.state
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.state)
    this.saving = this.saving.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(`${this.file}.tmp`, snapshot)
      await rename(`${this.file}.tmp`, this.file)
    }).catch(() => undefined)
    return this.saving
  }

  /** Called while the app is in active use. */
  async addActiveTime(ms: number): Promise<void> {
    const state = await this.load()
    if (state.sentAt || state.declined) return
    state.activeMs += Math.max(0, Math.min(ms, 5 * 60_000))
    await this.save()
  }

  async handle(command: FeedbackCommand): Promise<{ due: boolean; sent?: boolean }> {
    const state = await this.load()
    switch (command.kind) {
      case 'status':
        return { due: feedbackDue(state) }
      case 'later':
        state.laterAt.push(state.activeMs)
        await this.save()
        return { due: false }
      case 'never':
        state.declined = true
        await this.save()
        return { due: false }
      case 'send': {
        const response = await this.post(FEEDBACK_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-intoponet-app': this.version },
          body: JSON.stringify({ rating: command.rating, comment: command.comment, version: this.version }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) throw new Error('Feedback could not be sent. Check your connection and try again.')
        state.sentAt = new Date().toISOString()
        await this.save()
        return { due: false, sent: true }
      }
    }
  }
}
