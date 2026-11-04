import { expect } from 'bun:test'
import {
  Feed,
  type FeedItem,
  PublicBoard,
  PublicProfile,
  SeededBoard,
  SeededProfile,
  SeedRefused,
  TextItem,
} from '@styld/protocol'
import { Match, Schema } from 'effect'
import { client, emailOf, seedAccounts, send, signIn } from './Accounts.ts'
import { nativeOperatorToken, operatorClient } from './OperatorToken.ts'

// Test-only acceptance: the house inspiration boards (owner, 4 November 2026) seeded as the operator's seed runs them,
// through the public edge. Only the operator reaches the seed, and only into a configured house account; a board needs
// its garments imported; the profile and the board are built through the app's own services, the board public only
// once its table is pinned and laid out, so What's new shows it once; the same entry again changes nothing; a
// Slovenian reader reads the board and profile in Slovenian; the board is marked Generated; removing it takes it down.

const house = 'native-house'
const email = emailOf(house)

const garments = [
  { manifestId: 'w-dresses-black', type: 'dresses', colour: 'blue' },
  { manifestId: 'w-knitwear-beige', type: 'knitwear', colour: 'green' },
  { manifestId: 'u-trainers-white', type: 'trainers', colour: 'red' },
  { manifestId: 'w-bags-brown', type: 'bags', colour: 'green' },
] as const

const entry = (operationId: string, to = email) => ({
  operationId,
  email: to,
  version: 1,
  board: {
    name: 'Black dress, white trainers',
    build: 'pack',
    paper: 'stock',
    moods: ['weekend'],
    labels: [{ text: 'Four pieces', style: 'label', sl: 'Štirje kosi' }],
    pieces: garments.map(({ manifestId }) => manifestId),
    tags: [
      { kind: 'audience', value: 'women' },
      { kind: 'template', value: 'pack' },
    ],
    sl: { name: 'Črna obleka, bele superge', review: 'pending' },
  },
})

const profile = {
  operationId: 'seed-native-profile-1',
  email,
  handle: 'native.house',
  name: 'Native House',
  bio: 'Outfit formulas.',
  sl: { name: 'Domača hiša', bio: 'Formule za videze.', review: 'pending' },
}

/** A public read as a reader in a language, by the website's own cookie. */
const readAs = (origin: string, locale: 'en' | 'sl') => (path: string) =>
  fetch(`${origin}${path}`, { headers: { cookie: `styld_locale=${locale}` } })

export const verifySeed = async (origin: string, testUrl: string) => {
  await seedAccounts(testUrl, house, 'native-house-other', 'native-house-reader')
  const operator = operatorClient(origin, nativeOperatorToken)
  const reader = client(origin, await signIn(origin, 'native-house-reader'))
  const board = '/api/operator/seed/boards/w-native-pack'

  // Nobody but the operator reaches the seed, and the operator only a house account.
  expect((await fetch(`${origin}/api/operator/seed/pieces?email=${encodeURIComponent(email)}`)).status).toBe(404)
  expect((await send(reader, board, 'POST', entry('seed-native-board-0'))).status).toBe(404)
  const elsewhere = await send(operator, board, 'POST', entry('seed-native-board-0', emailOf('native-house-other')))
  expect(Schema.decodeUnknownSync(SeedRefused)(await elsewhere.json()).reason).toBe('notHouse')
  // A board waits for its garments to be imported.
  const early = await send(operator, board, 'POST', entry('seed-native-board-1'))
  expect(Schema.decodeUnknownSync(SeedRefused)(await early.json())).toMatchObject({ reason: 'piecesMissing' })

  const put = await fetch(`${testUrl}/test/seed/garments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId: house, garments }),
  })
  expect(put.status).toBe(204)
  const seededProfile = await send(operator, '/api/operator/seed/profile', 'PUT', profile)
  expect(seededProfile.status).toBe(200)
  expect(Schema.decodeUnknownSync(SeededProfile)(await seededProfile.json())).toMatchObject({ check: 'passed' })

  const created = Schema.decodeUnknownSync(SeededBoard)(
    await (await send(operator, board, 'POST', entry('seed-native-board-2'))).json(),
  )
  expect(created).toMatchObject({ outcome: 'created', visibility: 'public', check: 'passed' })
  // The same entry again, under another operation: nothing changes, and it is the same board.
  const again = Schema.decodeUnknownSync(SeededBoard)(
    await (await send(operator, board, 'POST', entry('seed-native-board-3'))).json(),
  )
  expect(again).toMatchObject({ outcome: 'unchanged', boardId: created.boardId })

  const english = Schema.decodeUnknownSync(PublicBoard)(
    await (await readAs(origin, 'en')(`/api/public/boards/${created.boardId}`)).json(),
  )
  expect([english.name, english.generated, english.by.name]).toEqual([
    'Black dress, white trainers',
    true,
    'Native House',
  ])
  const slovenian = Schema.decodeUnknownSync(PublicBoard)(
    await (await readAs(origin, 'sl')(`/api/public/boards/${created.boardId}`)).json(),
  )
  expect([slovenian.name, slovenian.by.name]).toEqual(['Črna obleka, bele superge', 'Domača hiša'])
  expect(slovenian.items.flatMap((item) => (Schema.is(TextItem)(item) ? [item.text] : []))).toEqual(['Štirje kosi'])
  const page = Schema.decodeUnknownSync(PublicProfile)(
    await (await readAs(origin, 'sl')('/api/public/profiles/native.house')).json(),
  )
  expect(page.bio).toBe('Formule za videze.')

  // Its pins were added before it went public: What's new shows the board once, no pin of it.
  const feed = Schema.decodeUnknownSync(Feed)(await (await reader('/api/feed')).json())
  const shows = (item: FeedItem) =>
    Match.value(item).pipe(
      Match.tagsExhaustive({
        BoardWentPublic: ({ board: went }) => (went.id === created.boardId ? ['board'] : []),
        PinnedOnBoard: ({ boardId }) => (boardId === created.boardId ? ['pin'] : []),
        SharedLook: () => [],
      }),
    )
  expect(feed.items.flatMap(shows)).toEqual(['board'])

  // Removed, it is gone for good: its status and its page.
  expect((await send(operator, board, 'DELETE', { operationId: 'seed-native-remove-1', email })).status).toBe(204)
  expect((await operator(`${board}?email=${encodeURIComponent(email)}`)).status).toBe(404)
  expect((await fetch(`${origin}/api/public/boards/${created.boardId}`)).status).toBe(404)
}
