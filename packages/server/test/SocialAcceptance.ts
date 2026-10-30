import { expect } from 'bun:test'
import { type Call, client, signIn } from './WardrobeAcceptance.ts'

/** Test-only acceptance: profiles and what other people may see, through the public edge. */

const send = (call: Call, path: string, method: string, body: unknown) =>
  call(path, { method, body: JSON.stringify(body) })

const refusal = async (response: Response, status: number, tag: string) => {
  expect(response.status).toBe(status)
  expect(await response.json()).toMatchObject({ _tag: tag })
}

/** A profile: unpublished on the name the account signed up with until it is saved, a handle that must be free and
 * not reserved, and published only with one. */
const verifyProfiles = async (origin: string, owner: Call, other: Call) => {
  expect((await fetch(`${origin}/api/profile`)).status).toBe(401)
  expect(await (await owner('/api/profile')).json()).toMatchObject({
    handle: null,
    name: 'Native Identity',
    published: false,
    wardrobeShown: true,
  })
  await refusal(await send(owner, '/api/profile/published', 'PUT', { published: true }), 422, 'ProfileNeedsHandle')
  await refusal(await send(owner, '/api/profile', 'PATCH', { handle: 'styld' }), 422, 'HandleReserved')
  expect((await send(owner, '/api/profile', 'PATCH', { handle: 'Not A Handle' })).status).toBe(400)
  const nika = { handle: 'nika.kovac', name: 'Nika Kovač', city: 'Maribor', bio: 'Red, black and one good coat.' }
  const saved = await send(owner, '/api/profile', 'PATCH', { ...nika, tone: 'clay' })
  expect(saved.status).toBe(200)
  expect(await saved.json()).toMatchObject({ ...nika, tone: 'clay', published: false })
  await refusal(await send(other, '/api/profile', 'PATCH', { handle: 'nika.kovac' }), 409, 'HandleTaken')
  const published = await send(owner, '/api/profile/published', 'PUT', { published: true })
  expect(await published.json()).toMatchObject({ handle: 'nika.kovac', published: true })
  expect(await (await send(owner, '/api/profile', 'PATCH', { city: null })).json()).toMatchObject({
    city: null,
    published: true,
  })
  const hidden = await send(owner, '/api/profile/published', 'PUT', { published: false })
  expect(await hidden.json()).toMatchObject({ published: false })
}

/** Profiles and what other people may see of each account. */
export const verifySocial = async (origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-social`, { method: 'POST' })).status).toBe(204)
  const owner = client(origin, await signIn(origin, 'native-social'))
  const other = client(origin, await signIn(origin, 'native-social-other'))
  await verifyProfiles(origin, owner, other)
}
