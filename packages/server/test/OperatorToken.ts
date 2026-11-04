import type { Call } from './Accounts.ts'

// The native stack's operator token (`RuntimeStack.ts` binds it; the import, picture backfill and photo re-find journeys
// use it). Test-only: it never leaves this process.
export const nativeOperatorToken = 'native-operator-token-for-the-local-stack-only-0123456789'

/** Requests as the operator's tools make them: a bearer token, no cookie. */
export const operatorClient =
  (origin: string, token: string): Call =>
  (path, init) => {
    const headers = new Headers({ origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' })
    for (const [name, value] of new Headers(init?.headers)) headers.set(name, value)
    return fetch(`${origin}${path}`, { ...init, headers })
  }
