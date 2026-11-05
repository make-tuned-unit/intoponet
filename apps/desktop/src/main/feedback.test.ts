import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEEDBACK_URL, FeedbackService, feedbackDue, parseFeedbackCommand } from './feedback'

const minutes = (n: number): number => n * 60_000
const service = (post?: (url: string, init: RequestInit) => Promise<Response>) => {
  const file = join(mkdtempSync(join(tmpdir(), 'feedback-')), 'feedback.json')
  return { file, feedback: new FeedbackService(file, '0.1.11', post) }
}
const use = async (feedback: FeedbackService, total: number): Promise<void> => {
  for (let i = 0; i < total; i += 5) await feedback.addActiveTime(minutes(5))
}

describe('when to ask for feedback', () => {
  it('asks after an hour of use, then twice more at most after "Not now"', async () => {
    const { feedback } = service()
    await use(feedback, 55)
    expect((await feedback.handle({ kind: 'status' })).due).toBe(false)
    await use(feedback, 5)
    expect((await feedback.handle({ kind: 'status' })).due).toBe(true)
    await feedback.handle({ kind: 'later' })
    expect((await feedback.handle({ kind: 'status' })).due).toBe(false)
    await use(feedback, 180)
    expect((await feedback.handle({ kind: 'status' })).due).toBe(true)
    await feedback.handle({ kind: 'later' })
    await use(feedback, 180)
    await feedback.handle({ kind: 'later' })
    await use(feedback, 600)
    expect((await feedback.handle({ kind: 'status' })).due).toBe(false)
  })

  it('never asks again once declined', async () => {
    const { feedback } = service()
    await use(feedback, 60)
    await feedback.handle({ kind: 'never' })
    await use(feedback, 600)
    expect((await feedback.handle({ kind: 'status' })).due).toBe(false)
  })

  it('a long gap counts as at most five minutes of use', () => {
    expect(feedbackDue({ activeMs: minutes(59), laterAt: [], sentAt: null, declined: false })).toBe(false)
  })
})

describe('sending feedback', () => {
  it('sends only the rating, the comment and the app version, then stops asking', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const { feedback, file } = service(async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 202 }) })
    await use(feedback, 60)
    expect(await feedback.handle({ kind: 'send', rating: 4, comment: 'Love the globe' })).toEqual({ due: false, sent: true })
    expect(calls[0]!.url).toBe(FEEDBACK_URL)
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ rating: 4, comment: 'Love the globe', version: '0.1.11' })
    expect(JSON.parse(readFileSync(file, 'utf8')).sentAt).toBeTruthy()
    expect((await feedback.handle({ kind: 'status' })).due).toBe(false)
  })

  it('keeps asking when sending fails', async () => {
    const { feedback } = service(async () => new Response(null, { status: 500 }))
    await use(feedback, 60)
    await expect(feedback.handle({ kind: 'send', rating: 5, comment: '' })).rejects.toThrow(/could not be sent/)
    expect((await feedback.handle({ kind: 'status' })).due).toBe(true)
  })

  it('needs a rating or a comment', () => {
    expect(() => parseFeedbackCommand({ kind: 'send', rating: null, comment: '  ' })).toThrow()
    expect(parseFeedbackCommand({ kind: 'send', rating: 9, comment: 'ok' })).toEqual({ kind: 'send', rating: null, comment: 'ok' })
    expect(parseFeedbackCommand({ kind: 'send', rating: 3, comment: 'x'.repeat(5000) })).toMatchObject({ rating: 3 })
  })
})
