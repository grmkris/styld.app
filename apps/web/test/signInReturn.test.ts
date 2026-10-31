import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { noteReturn, tookReturn } from '../src/SignInReturn.ts'

// A tab with session storage and an address, as the browser keeps them; `go` opens an address in it.
const tab = () => {
  const stored = new Map<string, string>()
  const location = { href: '', origin: 'https://styld.test', pathname: '', search: '', hash: '' }
  const go = (path: string) => {
    const url = new URL(path, location.origin)
    Object.assign(location, { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash })
  }
  vi.stubGlobal('window', {
    location,
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
    history: { state: null, replaceState: (_state: unknown, _title: string, path: string) => go(path) },
  })
  return { location, go }
}

describe('a Follow pressed signed out, returned to by sign-in', () => {
  let browser: ReturnType<typeof tab>
  beforeEach(() => {
    browser = tab()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('the arrival this tab asked for is taken once, and #follow leaves the address', () => {
    browser.go('/login?next=%2F%40nika.kovac%23follow')
    Effect.runSync(noteReturn('/@nika.kovac#follow'))
    browser.go('/@nika.kovac#follow')
    expect(Effect.runSync(tookReturn)).toBe(true)
    expect(browser.location.href).toBe('https://styld.test/@nika.kovac')
    // A reload, or Back to the address with its fragment, finds nothing noted.
    browser.go('/@nika.kovac#follow')
    expect(Effect.runSync(tookReturn)).toBe(false)
  })

  test('a link that only ends in #follow, or a note for another page, follows nobody', () => {
    browser.go('/@nika.kovac#follow')
    expect(Effect.runSync(tookReturn)).toBe(false)
    expect(browser.location.href).toBe('https://styld.test/@nika.kovac')
    Effect.runSync(noteReturn('/@ana#follow'))
    browser.go('/@nika.kovac#follow')
    expect(Effect.runSync(tookReturn)).toBe(false)
  })

  test('without storage the page opens all the same and follows nobody', () => {
    vi.stubGlobal('window', {
      location: browser.location,
      sessionStorage: {
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      },
    })
    expect(() => Effect.runSync(noteReturn('/@nika.kovac#follow'))).not.toThrow()
    expect(Effect.runSync(tookReturn)).toBe(false)
  })
})
