import { expect } from 'bun:test'

/** A page's first signed-in requests arrive together. On an isolate whose application was built without
 * reading a session, none may wait on another request's session setup, which workerd cancels as hung:
 * four session reads and four account reads are all answered. */
export const verifyFirstSignedInTogether = async (origin: string, cookie: string): Promise<void> => {
  const session = () =>
    fetch(`${origin}/api/auth/getSession`, {
      method: 'POST',
      headers: {
        origin: new URL(origin).origin,
        'content-type': 'application/json',
        'x-effect-auth-csrf': '1',
        cookie,
      },
      body: JSON.stringify({ payload: {} }),
    }).then((response): Promise<unknown> => response.json())
  const account = () => fetch(`${origin}/api/me`, { headers: { cookie } }).then((response) => response.status)
  const [sessions, statuses] = await Promise.all([
    Promise.all(Array.from({ length: 4 }, session)),
    Promise.all(Array.from({ length: 4 }, account)),
  ])
  for (const reply of sessions) {
    expect(reply).toMatchObject({ _tag: 'Success', value: { subjectId: 'native-recovery' } })
  }
  expect(statuses).toEqual([200, 200, 200, 200])
}
