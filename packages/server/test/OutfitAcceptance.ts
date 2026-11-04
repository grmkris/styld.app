import { expect } from 'bun:test'
import { Schema } from 'effect'
import { idOf } from './GalleryAcceptance.ts'
import { receivedPhoto, waitUntilReady } from './WardrobeAcceptance.ts'
import { type Call, client, seedAccounts, send, signIn } from './Accounts.ts'

/** Test-only acceptance: the outfit engine through the public edge, Clef's stand-in ranking (red pieces go best) and
 * the rules standing in for Thinking's model (`[[unclear]]` in the words answers nothing usable). */

const Proposals = Schema.Struct({
  session: Schema.String,
  mode: Schema.String,
  proposals: Schema.Array(
    Schema.Struct({ key: Schema.String, pieceIds: Schema.Array(Schema.String), score: Schema.NullOr(Schema.Number) }),
  ),
  missing: Schema.Array(Schema.String),
  exhausted: Schema.Boolean,
})
type Proposals = typeof Proposals.Type

const make = (call: Call, ask: object = {}) =>
  send(call, '/api/outfits', 'POST', { mode: 'fast', brief: {}, lockedPieceIds: [], seen: [], count: 6, ...ask })

const proposalsOf = async (response: Response): Promise<Proposals> => {
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Proposals)(await response.json())
}

/** A ready piece of a type, added from a received photo. */
export const ready = async (origin: string, call: Call, operationId: string, type: string) => {
  const pieceId = await idOf(
    await send(call, '/api/pieces', 'POST', { operationId, uploadId: await receivedPhoto(origin, call), type }),
  )
  expect(await waitUntilReady(call, pieceId)).toBe('ready')
  return pieceId
}

/** Every proposal wears one top, one bottom and the shoes, all the account's own, and each combination once. */
const expectWhole = (
  batch: Proposals,
  wardrobe: { tops: ReadonlyArray<string>; bottoms: ReadonlyArray<string>; shoes: string },
) => {
  for (const { pieceIds, key, score } of batch.proposals) {
    expect(pieceIds.filter((id) => wardrobe.tops.includes(id))).toHaveLength(1)
    expect(pieceIds.filter((id) => wardrobe.bottoms.includes(id))).toHaveLength(1)
    expect(pieceIds).toContain(wardrobe.shoes)
    expect(pieceIds).toHaveLength(3)
    expect(key).toBe(pieceIds.toSorted().join('.'))
    expect(score).not.toBeNull()
  }
  expect(new Set(batch.proposals.map(({ key }) => key)).size).toBe(batch.proposals.length)
}

/** Fast: a ranked batch of whole outfits, nothing shown twice, around an anchor, and the account's own pieces only. */
const verifyFast = async (origin: string, owner: Call, other: Call) => {
  const empty = await proposalsOf(await make(owner))
  expect(empty).toMatchObject({ proposals: [], missing: ['top', 'bottom', 'shoes'], exhausted: true })
  const wardrobe = {
    tops: [
      await ready(origin, owner, 'native-outfit-top-1', 'tops'),
      await ready(origin, owner, 'native-outfit-top-2', 'shirts'),
    ],
    bottoms: [
      await ready(origin, owner, 'native-outfit-bottom-1', 'jeans'),
      await ready(origin, owner, 'native-outfit-bottom-2', 'skirts'),
    ],
    shoes: await ready(origin, owner, 'native-outfit-shoes', 'trainers'),
  }
  const first = await proposalsOf(await make(owner))
  expect(first.session).toMatch(/^os_[A-Za-z0-9_-]{22}$/)
  expect(first).toMatchObject({ mode: 'fast', missing: [], exhausted: true })
  expect(first.proposals).toHaveLength(4)
  expectWhole(first, wardrobe)
  // A day's first outfits are the same each time they are asked for, so Home's table holds all day.
  const keysFor = async (day: string) => (await proposalsOf(await make(owner, { day }))).proposals.map(({ key }) => key)
  expect(await keysFor('2026-10-31')).toEqual(await keysFor('2026-10-31'))
  // Shown combinations never come back: with all four seen, the rules have none left.
  const more = await proposalsOf(
    await make(owner, { session: first.session, seen: first.proposals.map(({ key }) => key) }),
  )
  expect(more).toMatchObject({ session: first.session, proposals: [], exhausted: true })
  const [, skirt = ''] = wardrobe.bottoms
  const anchored = await proposalsOf(await make(owner, { anchorPieceId: skirt }))
  expect(anchored.proposals).toHaveLength(2)
  for (const { pieceIds } of anchored.proposals) expect(pieceIds).toContain(skirt)
  // Someone else's piece is no anchor, and no lock.
  expect((await make(other, { anchorPieceId: wardrobe.tops[0] })).status).toBe(404)
  expect((await make(other, { lockedPieceIds: [wardrobe.shoes] })).status).toBe(404)
  return wardrobe
}

/** Thinking: proposals kept to the same rules; a model that answers nothing usable is an error offering Fast; six a
 * minute at most. Wear this reports the proposal it came from. */
const verifyThinking = async (owner: Call, wardrobe: Awaited<ReturnType<typeof verifyFast>>) => {
  const thought = await proposalsOf(await make(owner, { mode: 'thinking' }))
  expect(thought.mode).toBe('thinking')
  expect(thought.proposals.length).toBeGreaterThan(0)
  expectWhole(thought, wardrobe)
  const unclear = await make(owner, { mode: 'thinking', brief: { words: 'something [[unclear]]' } })
  expect(unclear.status).toBe(503)
  expect(await unclear.json()).toMatchObject({ _tag: 'ThinkingUnanswered' })
  const [chosen] = thought.proposals
  if (chosen === undefined) throw new Error('Thinking proposed nothing')
  const worn = await owner('/api/worn/2026-10-31', {
    method: 'PUT',
    body: JSON.stringify({
      pieceIds: chosen.pieceIds,
      proposal: { session: thought.session, mode: 'thinking', position: 0, edited: false },
    }),
  })
  expect(worn.status).toBe(200)
  const statuses: Array<number> = []
  for (let ask = 0; ask < 6; ask += 1) statuses.push((await make(owner, { mode: 'thinking' })).status)
  expect(statuses).toContain(429)
  // Fast keeps its own, wider pace.
  expect((await make(owner)).status).toBe(200)
}

/** The outfit engine for the website and the assistants. */
export const verifyOutfits = async (origin: string, fixtures: string): Promise<void> => {
  await seedAccounts(fixtures, 'native-outfits', 'native-outfits-other')
  const owner = client(origin, await signIn(origin, 'native-outfits'))
  const other = client(origin, await signIn(origin, 'native-outfits-other'))
  expect((await fetch(`${origin}/api/outfits`, { method: 'POST', body: '{}' })).status).toBe(401)
  const wardrobe = await verifyFast(origin, owner, other)
  await verifyThinking(owner, wardrobe)
  const cap = await fetch(`${fixtures}/test/identity/thinking-cap`, { method: 'POST' })
  expect(cap.status).toBe(200)
  expect(await cap.json()).toEqual({ counted: [true, true, false, true], afterSweep: true })
}
