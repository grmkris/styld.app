import { expect } from 'bun:test'
import type { Browser, BrowserContext } from 'playwright'
import { testPassword } from './IdentityFixture.ts'

// The native suite's accounts: seeded on the fixture Worker, each with the same password, signed in through the real
// edge. One place for the seed call, the sign-in and the signed-in browser, so every test does them the same way.

/** A seeded account's sign-in email. */
const emailOf = (id: string) => `${id}@example.invalid`

/** The sign-in request's body for a seeded account. */
export const signInBody = (id: string, password = testPassword) => ({ payload: { email: emailOf(id), password } })

/** Seed the accounts on the fixture Worker, each with a verified email and the test password. */
export const seedAccounts = async (fixtures: string, ...ids: ReadonlyArray<string>) => {
  const response = await fetch(`${fixtures}/test/identity/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  expect(response.status).toBe(204)
}

/** Sign a seeded account in with its password; the session cookie comes back. */
export const signIn = async (origin: string, id: string) => {
  const response = await fetch(`${origin}/api/auth/signIn`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-effect-auth-csrf': '1' },
    body: JSON.stringify(signInBody(id)),
  })
  expect(response.status).toBe(200)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

/** The paths whose writes are the typed API's, each naming its operation; sign-in, telemetry and an upload's bytes
 * are not. */
const namesOperation = (path: string, method: string) =>
  method !== 'GET' &&
  path.startsWith('/api/') &&
  !['/api/auth/', '/api/telemetry/', '/api/uploads/up_'].some((prefix) => path.startsWith(prefix))

/** The website names every write's operation: a request that chose none gets a new one, as a new change would. */
export const withOperation = (path: string, init: RequestInit): RequestInit => {
  if (!namesOperation(path, (init.method ?? 'GET').toUpperCase())) return init
  if (init.body !== undefined && typeof init.body !== 'string') return init
  const body: unknown = init.body === undefined ? {} : JSON.parse(init.body)
  if (typeof body !== 'object' || body === null || Array.isArray(body) || 'operationId' in body) return init
  return { ...init, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) }
}

/** Requests the website would send for the signed-in account. */
export const client =
  (origin: string, cookie: string) =>
  (path: string, init: RequestInit = {}) => {
    const headers = new Headers({ origin, cookie, 'x-effect-auth-csrf': '1', 'content-type': 'application/json' })
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value)
    return fetch(`${origin}${path}`, { ...withOperation(path, init), headers })
  }

export type Call = ReturnType<typeof client>

/** A JSON request through a signed-in account's calls. */
export const send = (call: Call, path: string, method: string, body?: unknown) =>
  call(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

/** A browser signed in as the account, with the diagnostics prompt already answered (it otherwise rises over the
 * page's actions) unless `answered` is false. */
export const signedInContext = async (
  browser: Browser,
  origin: string,
  id: string,
  options: {
    readonly viewport?: { width: number; height: number }
    readonly answered?: boolean
    readonly hasTouch?: boolean
    readonly permissions?: ReadonlyArray<string>
  } = {},
) => {
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: options.viewport ?? { width: 390, height: 844 },
    ...(options.hasTouch === undefined ? {} : { hasTouch: options.hasTouch }),
    ...(options.permissions === undefined ? {} : { permissions: [...options.permissions] }),
  })
  if (options.answered ?? true) await context.addCookies([{ name: 'styld_diagnostics', value: 'denied', url: origin }])
  const signedIn = await context.request.post(`${origin}/api/auth/signIn`, {
    headers: { origin, 'x-effect-auth-csrf': '1' },
    data: signInBody(id),
  })
  expect(signedIn.status()).toBe(200)
  return context
}

/** Leave the signed-in account `leave` of today's credits: the native Worker spends the rest, so a journey reaches the
 * daily limit without paying its way there. */
export const leaveCredits = async (origin: string, context: BrowserContext, leave: number) => {
  const me: unknown = await (await context.request.get(`${origin}/api/me`)).json()
  const accountId = typeof me === 'object' && me !== null && 'accountId' in me ? me.accountId : undefined
  const spent = await context.request.post(`${origin}/api/native/spend`, {
    headers: { origin, 'x-effect-auth-csrf': '1' },
    data: { accountId, leave },
  })
  expect(spent.status()).toBe(204)
}
