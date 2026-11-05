import { describe, expect, it } from 'vitest'
import { emulatedColorScheme, PageAppearanceController, parsePageAppearanceFile, type ThemedPage } from './pageAppearance'

function fakePage() {
  const commands: Array<[string, unknown]> = []
  const listeners: Record<string, () => void> = {}
  let attached = false
  const page: ThemedPage = {
    debugger: {
      isAttached: () => attached,
      attach: () => { attached = true },
      detach: () => { attached = false },
      sendCommand: async (method, params) => { commands.push([method, params]); return {} },
    },
    isDestroyed: () => false,
    on: (event, listener) => { listeners[event] = listener },
    once: (event, listener) => { listeners[event] = listener },
  }
  return { page, commands, listeners, attached: () => attached }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('page appearance', () => {
  it('follows the system by default and reads the saved choice', () => {
    expect(emulatedColorScheme('system')).toBeNull()
    expect(emulatedColorScheme('dark')).toBe('dark')
    expect(parsePageAppearanceFile(null)).toBe('system')
    expect(parsePageAppearanceFile({ pageAppearance: 'light' })).toBe('light')
    expect(parsePageAppearanceFile({ pageAppearance: 'sepia' })).toBe('system')
  })

  it('leaves pages alone on "Match system" (no debugger attached)', async () => {
    const controller = new PageAppearanceController('system')
    const fake = fakePage()
    controller.watch(fake.page)
    await settle()
    expect(fake.attached()).toBe(false)
    expect(fake.commands).toEqual([])
  })

  it('emulates Light or Dark, keeps it across navigations, and lets go for "Match system"', async () => {
    const controller = new PageAppearanceController('dark')
    const fake = fakePage()
    controller.watch(fake.page)
    await settle()
    expect(fake.commands.at(-1)).toEqual(['Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }])
    controller.set('light')
    await settle()
    expect(fake.commands.at(-1)).toEqual(['Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }])
    fake.commands.length = 0
    fake.listeners['did-start-navigation']?.()
    await settle()
    expect(fake.commands).toHaveLength(1)
    controller.set('system')
    await settle()
    expect(fake.attached()).toBe(false)
  })

  it('never detaches a debugger it did not attach (DevTools)', async () => {
    const controller = new PageAppearanceController('system')
    const fake = fakePage()
    fake.page.debugger.attach()
    controller.watch(fake.page)
    controller.set('system')
    await settle()
    expect(fake.attached()).toBe(true)
  })
})
