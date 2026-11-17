import { describe, expect, it } from 'vitest'
import { oldsErrorMessage } from './oldsError'

// Errors arrive from the main process wrapped by Electron's IPC.
const viaIpc = (message: string): Error => new Error(`Error invoking remote method 'intoponet:olds': Error: ${message}`)

describe('what The Olds says when a lookup fails', () => {
  it('says the servers are not answering for an error status, rate limiting or an unreadable answer', () => {
    for (const message of [
      'Wikipedia and Wikidata are not answering properly right now. Try again in a moment.',
      'www.wikidata.org responded 500.',
      'en.wikipedia.org is rate limiting requests.',
      'en.wikipedia.org sent an answer that could not be read.',
    ]) expect(oldsErrorMessage(viaIpc(message))).toMatch(/not answering properly right now\. Try again/)
  })

  it('says the network could not be reached when there is none', () => {
    expect(oldsErrorMessage(viaIpc('Wikipedia could not be reached over the network. Try again once you are online.'))).toMatch(/^Could not reach/)
    expect(oldsErrorMessage(new TypeError('fetch failed'))).toMatch(/^Could not reach/)
  })

  it('says there is no history only when Wikipedia answered and nothing matched', () => {
    expect(oldsErrorMessage(viaIpc('No Wikipedia topic matched this headline.'))).toBe('No sourced history could be found for this.')
    expect(oldsErrorMessage(viaIpc('No Wikidata item for that country.'))).toBe('No sourced history could be found for this.')
  })
})
