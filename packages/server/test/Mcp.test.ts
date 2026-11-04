import { SignedMedia } from '../src/kernel/SignedMedia.ts'
import { media, withThumbnail } from './McpMediaFixture.ts'
import {
  type ArrangeBoard,
  Board,
  BoardImageId,
  BoardVersionConflict,
  CurrentAccount,
  Handle,
  OperationId,
  PictureRefused,
  type Piece,
  PieceId,
  type RedrawPicture,
  UploadId,
} from '@styld/protocol'
import { Effect, Exit, Layer, Redacted, Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { readResource, resources, viewsUri } from '../src/mcp/Resources.ts'
import { instructions, styldTools } from '../src/mcp/StyldTools.ts'
import { callTool, renderTools } from '../src/mcp/Tools.ts'
import { challenge, hostedClientMetadata, redirectUriAllowed } from '../src/mcp/Policy.ts'
import { Wardrobe } from '../src/wardrobe/Wardrobe.ts'
import { noLooks } from './fakes/Looks.ts'
import { Boards } from '../src/boards/Boards.ts'
import { Profiles } from '../src/social/Profiles.ts'
import { everyCall, toolNames } from './ToolNames.ts'
import { Discovery } from '../src/social/Discovery.ts'
import { Social } from '../src/social/Social.ts'
import { curationTools } from '../src/mcp/CurationTools.ts'
import { adminEmails, Curation, isAdmin } from '../src/social/Curation.ts'
import { fetchOperation, Links } from '../src/links/Links.ts'
import { unlimited } from './fakes/Pacing.ts'
import { unusedBoards } from './fakes/Boards.ts'

/** The account service: Ana, with her verified email. */
const accounts = {
  readAccount: () => Effect.succeed({ accountId: 'acc_1', displayName: 'Ana Novak', email: 'ana@example.com' }),
}
/** A piece no one has described yet: no seasons (all year), not rainproof, no occasions, pattern, brand, shop link or back. */
const undescribed = {
  seasons: [],
  rainproof: false,
  category: null,
  occasions: [],
  pattern: null,
  brand: null,
  shopUrl: null,
  hasBack: false,
  rotation: 0,
} as const
const piece = (id: string, fields: Partial<Piece>): Piece => ({
  ...undescribed,
  id: PieceId.make(`pc_${id.padEnd(22, '0')}`),
  type: 'tops',
  name: null,
  notes: null,
  colours: [],
  source: 'website',
  status: 'ready',
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
  ...fields,
})
const pieces = [
  piece('a', { name: 'Navy cable knit', type: 'knitwear', colours: ['navy'] }),
  piece('b', { name: 'White tee', colours: ['white'] }),
  piece('c', { name: 'Jeans', type: 'jeans', colours: ['blue', 'navy'] }),
]
/** Answers reads from three pieces; anything else is not part of these tests. */
const notUsed = () => Effect.die('not used by these tests')
/** The upload an earlier try of `picture-replay-1` fetched, as the receipt of its fetch (`replayedFetch`) answers. */
const replayedUpload = UploadId.make(`up_${'replay'.padEnd(22, 'x')}`)
const replayedFetch = await Effect.runPromise(fetchOperation(OperationId.make('picture-replay-1'), 'picture_pin'))
const wardrobe = Wardrobe.of({
  listPieces: () => withThumbnail(pieces, pieces[0]?.id ?? ''),
  getPiece: notUsed,
  newUpload: notUsed,
  createUpload: notUsed,
  // Operations with a receipt answer from it; the rest run.
  once: (operation, answer) =>
    operation.operationId === replayedFetch
      ? answer.replay(replayedUpload)
      : Effect.map(answer.run, ([value]) => value),
  receiveUpload: notUsed,
  receiveVideoUpload: notUsed,
  addPiece: notUsed,
  updatePiece: notUsed,
  deletePiece: notUsed,
  setBack: notUsed,
  removeBack: notUsed,
  choosePicture: notUsed,
  processPiece: notUsed,
  failPiece: notUsed,
  sweepUploads: notUsed,
})
/** Redraws: the first piece is drawn again; the second shows its original photo, which is never sent on. */
const redraws: Array<{ readonly pieceId: string; readonly input: RedrawPicture }> = []
const captures = {
  redrawPicture: (pieceId: string, input: RedrawPicture) =>
    Effect.gen(function* () {
      if (pieceId !== pieces[0]?.id) return yield* PictureRefused.make({ reason: 'photo' })
      redraws.push({ pieceId, input })
      return { state: 'drawing' as const, shows: 'photo' as const, version: 1 }
    }),
}
/** Boards: one board, an arrangement that records what it was asked, and a table that was saved meanwhile. */
const board = Schema.decodeUnknownSync(Board)({
  id: `bd_${'autumn'.padEnd(22, 'x')}`,
  name: 'Autumn',
  paper: 'sage',
  version: 3,
  items: [
    {
      _tag: 'PieceItem',
      id: `bi_${'knit'.padEnd(22, 'x')}`,
      pieceId: pieces[0]?.id,
      x: 300,
      y: 320,
      size: 380,
      turn: 0,
      z: 1,
      flipped: false,
    },
    {
      _tag: 'TextItem',
      id: `bi_${'rain'.padEnd(22, 'x')}`,
      text: 'Rain',
      style: 'headline',
      x: 500,
      y: 600,
      size: 360,
      turn: 0,
      z: 2,
      flipped: false,
    },
  ],
  pins: [
    { _tag: 'PiecePin', id: `pn_${'knit'.padEnd(22, 'x')}`, piece: pieces[0], addedAt: '2026-10-30T08:00:00.000Z' },
  ],
  publicPins: [],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-30T08:00:00.000Z',
})
const arrangements: Array<ArrangeBoard> = []
/** The uploads pictures were pinned from. */
const pinnedUploads: Array<string> = []
const boards = Boards.of({
  ...unusedBoards,
  listBoards: () => Effect.succeed([]),
  getBoard: () => withThumbnail(board, pieces[0]?.id ?? ''),
  arrangeBoard: (_boardId, input) => Effect.sync(() => arrangements.push(input)).pipe(Effect.as(board)),
  setTable: () => Effect.fail(BoardVersionConflict.make({ version: 4 })),
  addBoardImage: (_boardId, { uploadId }) =>
    Effect.sync(() => pinnedUploads.push(uploadId)).pipe(
      Effect.as({ imageId: BoardImageId.make(`bm_${'replay'.padEnd(22, 'x')}`) }),
    ),
})
/** The profile: Ana's, published with a handle. */
const profiles = Profiles.of({
  getProfile: () =>
    Effect.succeed({
      handle: Schema.decodeUnknownSync(Handle)('ana.novak'),
      name: 'Ana Novak',
      city: 'Ljubljana',
      bio: null,
      tone: 'sage',
      published: true,
      check: { state: 'passed', reason: null, hidden: false },
    }),
  updateProfile: notUsed,
  publishProfile: notUsed,
})
/** Social: nothing saved or followed yet; anything else is not part of these tests. */
const social = Social.of({
  listSaved: () => Effect.succeed({ saved: [] }),
  setSaved: notUsed,
  relation: notUsed,
  setFollowing: notUsed,
  setBlocked: notUsed,
  following: () => Effect.succeed({ people: [] }),
  blocked: notUsed,
  feed: notUsed,
  report: notUsed,
})
/** Discovery: nothing public yet. */
const discovery = Discovery.of({
  explore: () => Effect.succeed({ edits: [], featured: [], people: [], newest: [] }),
  search: () => Effect.succeed({ people: [], boards: [] }),
})
/** Generations: not part of these tests. */
const generations = { admit: notUsed, get: notUsed }
/** Outfits: not part of these tests. */
const outfits = { make: notUsed, sweep: notUsed }
/** What Styld fetches from the web, over the wardrobe above, at no pace. */
const links = Effect.runSync(
  Links.pipe(
    Effect.provide(Links.layer.pipe(Layer.provide(Layer.merge(Layer.succeed(Wardrobe, wardrobe), unlimited)))),
  ),
)
const tools = styldTools('https://styld.test', {
  media,
  wardrobe,
  links,
  looks: noLooks,
  captures,
  boards,
  profiles,
  social,
  discovery,
  generations,
  outfits,
  accounts,
})
/** The JSON of a result's first text block. */
const jsonOf = (result: {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>
}): unknown => JSON.parse(result.content[0]?.text ?? 'null')
const call = (name: string, args: unknown) =>
  Effect.runPromise(
    callTool(tools, name, args).pipe(
      Effect.provideService(CurrentAccount, CurrentAccount.of({ accountId: 'acc_1', via: 'assistant' })),
      Effect.provide(SignedMedia.layer(Redacted.make('native-test-signing-secret-32-characters'))),
    ),
  )

describe('putting a picture on a board', () => {
  test('a retry answers from the fetch’s receipt, without fetching the address again', async () => {
    const result = await call('picture_pin', {
      boardId: board.id,
      operationId: 'picture-replay-1',
      imageUrl: 'https://pictures.test/rain.jpg',
    })
    expect(result.isError).toBeFalsy()
    expect(jsonOf(result)).toMatchObject({ id: board.id })
    expect(pinnedUploads).toContain(replayedUpload)
  })
})

describe('MCP tools', () => {
  test('lists closed, budgeted tools with noun_verb names', () => {
    const list = renderTools(tools)
    expect(list.slice(0, 1)).toEqual([
      {
        name: 'account_get',
        title: 'Your Styld account',
        description: 'The Styld account this connection acts for: name, email and a link to the account page.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { title: 'Your Styld account', readOnlyHint: true, openWorldHint: false },
      },
    ])
    expect(list.map(({ name }) => name)).toEqual([...toolNames])
    expect(list.find(({ name }) => name === 'piece_delete')?.annotations).toMatchObject({ destructiveHint: true })
    for (const entry of list) {
      expect(entry.name).toMatch(/^[a-z]+_[a-z]+$/)
      expect(`mcp__styld__${entry.name}`.length).toBeLessThanOrEqual(64)
      expect(entry.description.length).toBeLessThanOrEqual(600)
      expect(JSON.stringify(entry).length).toBeLessThanOrEqual(12 * 1024)
    }
    expect(instructions.split('\n\n')[0]?.length).toBeLessThanOrEqual(512)
  })

  test('shows the wardrobe in the Styld view, with the words in both languages', async () => {
    const entry = renderTools(tools).find(({ name }) => name === 'wardrobe_show')
    expect(entry).toMatchObject({ _meta: { ui: { resourceUri: viewsUri } } })
    const result = await call('wardrobe_show', {})
    expect(result.structuredContent).toMatchObject({
      _tag: 'WardrobeView',
      url: 'https://styld.test/wardrobe',
      pieces: [
        { name: 'Navy cable knit', group: 'clothing', url: `https://styld.test/wardrobe/${pieces[0]?.id}` },
        { name: 'White tee' },
        { name: 'Jeans', group: 'clothing' },
      ],
      labels: {
        en: { wardrobeTitle: 'Wardrobe', openInStyld: 'Open in Styld', groups: { shoes: 'Shoes' } },
        sl: { openInStyld: 'Odpri v Styldu' },
      },
    })
    // Pictures travel in `_meta`, out of the model's context, as data URLs the host's sandbox can show.
    expect(result).toHaveProperty('_meta', {
      'styld/images': { [pieces[0]?.id ?? '']: `data:image/webp;base64,${btoa('webp')}` },
    })
  })

  test('serves the view as one self-contained MCP Apps resource', () => {
    expect(resources).toEqual([expect.objectContaining({ uri: viewsUri, mimeType: 'text/html;profile=mcp-app' })])
    const read = readResource(viewsUri)
    const html = read?.contents[0]?.text ?? ''
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<div id="styld-view"></div>')
    // Nothing loads from the network: no external script, stylesheet or font.
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|@import|url\(https?:/)
    expect(readResource('ui://styld/other.html')).toBeUndefined()
  })

  test('lays out a collage from the protocol’s things, each a piece, a picture or a label', async () => {
    const knit = pieces[0]?.id ?? ''
    const result = await call('collage_arrange', {
      boardId: board.id,
      operationId: 'arrange-0001',
      layout: 'outfit',
      add: [
        { _tag: 'TablePiece', pieceId: knit },
        { _tag: 'TableLabel', text: 'Rain', style: 'headline' },
      ],
    })
    expect(result.structuredContent).toMatchObject({ id: board.id, url: `https://styld.test/boards/${board.id}` })
    expect(arrangements.at(-1)).toEqual({
      operationId: 'arrange-0001',
      layout: 'outfit',
      add: [
        { _tag: 'TablePiece', pieceId: knit },
        { _tag: 'TableLabel', text: 'Rain', style: 'headline' },
      ],
    })
    const twice = await call('collage_arrange', {
      boardId: board.id,
      operationId: 'arrange-0002',
      layout: 'keep',
      add: [{ _tag: 'TablePiece', pieceId: knit, text: 'Rain' }],
    })
    expect(jsonOf(twice)).toMatchObject({ code: 'invalid_arguments', retryable: false })
    expect(arrangements).toHaveLength(1)
  })

  test('shows a board in the Styld view: its collage, its pins and their pictures, out of the model’s context', async () => {
    const entry = renderTools(tools).find(({ name }) => name === 'board_show')
    expect(entry).toMatchObject({ _meta: { ui: { resourceUri: viewsUri } } })
    const result = await call('board_show', { boardId: board.id })
    const knit = pieces[0]?.id ?? ''
    expect(result.structuredContent).toMatchObject({
      _tag: 'BoardView',
      name: 'Autumn',
      paper: 'sage',
      url: `https://styld.test/boards/${board.id}`,
      pins: [{ name: 'Navy cable knit', image: `piece:${knit}`, url: `https://styld.test/wardrobe/${knit}` }],
      labels: { en: { pinned: 'Pinned', openInStyld: 'Open in Styld' }, sl: { pinned: 'V zbirki' } },
    })
    expect(result).toHaveProperty('_meta', {
      'styld/images': { [`piece:${knit}`]: `data:image/webp;base64,${btoa('webp')}` },
    })
  })

  test('tells the assistant to read the board again when its collage changed meanwhile', async () => {
    const result = await call('collage_set', {
      boardId: board.id,
      operationId: 'set-000001',
      version: 3,
      items: [{ thing: { _tag: 'TableLabel', text: 'Rain', style: 'label' }, x: 500, y: 600, size: 360 }],
    })
    expect(result.isError).toBe(true)
    expect(jsonOf(result)).toMatchObject({ code: 'version_conflict', retryable: true })
  })

  test('gives the profile its public link once it has a handle', async () => {
    expect((await call('profile_get', {})).structuredContent).toMatchObject({
      handle: 'ana.novak',
      published: true,
      url: 'https://styld.test/@ana.novak',
    })
  })

  test('answers with the account as text and structured content', async () => {
    const result = await call('account_get', {})
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({
      accountId: 'acc_1',
      displayName: 'Ana Novak',
      email: 'ana@example.com',
      url: 'https://styld.test/account',
    })
    expect(jsonOf(result)).toEqual(result.structuredContent)
  })

  test('asks for a redraw with the owner’s words, and says why a photo cannot be drawn', async () => {
    const first = pieces[0]?.id ?? ''
    const asked = await call('picture_redraw', {
      pieceId: first,
      operationId: 'redraw-0001',
      hint: 'a navy cable knit',
    })
    expect(asked.structuredContent).toEqual({
      pieceId: first,
      picture: { state: 'drawing', shows: 'photo', version: 1 },
      url: `https://styld.test/wardrobe/${first}`,
    })
    expect(redraws).toEqual([{ pieceId: first, input: { operationId: 'redraw-0001', hint: 'a navy cable knit' } }])
    const photo = await call('picture_redraw', { pieceId: pieces[1]?.id, operationId: 'redraw-0002' })
    expect(photo.isError).toBe(true)
    expect(jsonOf(photo)).toMatchObject({ code: 'picture_refused', retryable: false })
    const long = await call('picture_redraw', { pieceId: first, operationId: 'redraw-0003', hint: 'x'.repeat(81) })
    expect(jsonOf(long)).toMatchObject({ code: 'invalid_arguments' })
  })

  test('refuses unknown tools and unknown arguments without echoing values', async () => {
    const unknown = await call('piece_steal', {})
    expect(unknown.isError).toBe(true)
    expect(jsonOf(unknown)).toMatchObject({ code: 'unknown_tool', retryable: false })
    const extra = await call('account_get', { accountId: 'someone-else-secret' })
    expect(extra.isError).toBe(true)
    const refusal = jsonOf(extra)
    expect(refusal).toMatchObject({ code: 'invalid_arguments', retryable: false })
    expect(JSON.stringify(refusal)).toContain('accountId')
    expect(JSON.stringify(refusal)).not.toContain('someone-else-secret')
  })
})

describe('MCP wardrobe tools', () => {
  test('searches by words, garment type, group and colour, newest first, a page at a time', async () => {
    const navy = await call('piece_search', { colour: 'navy', limit: 1 })
    expect(navy.structuredContent).toMatchObject({
      pieces: [{ name: 'Navy cable knit', url: `https://styld.test/wardrobe/${pieces[0]?.id}` }],
      nextCursor: '1',
    })
    expect(await call('piece_search', { colour: 'navy', cursor: '1' })).toMatchObject({
      structuredContent: { pieces: [{ name: 'Jeans' }], nextCursor: null },
    })
    expect(await call('piece_search', { q: 'TEE' })).toMatchObject({
      structuredContent: { pieces: [{ name: 'White tee' }] },
    })
    expect(await call('piece_search', { type: 'trousers', q: 'tee' })).toMatchObject({
      structuredContent: { pieces: [] },
    })
  })

  test('never shows an image address', async () => {
    const result = await call('piece_search', {})
    expect(JSON.stringify(result)).not.toContain('/cdn/')
  })

  test('adds from exactly one of a photo address or an upload', async () => {
    const both = await call('piece_add', {
      operationId: 'op-both-0001',
      imageUrl: 'https://photos.example/knit.jpg',
      uploadId: `up_${'a'.repeat(22)}`,
      type: 'tops',
    })
    expect(jsonOf(both)).toMatchObject({ code: 'invalid_arguments' })
    expect(jsonOf(await call('piece_add', { operationId: 'op-none-0001', type: 'tops' }))).toMatchObject({
      code: 'invalid_arguments',
    })
  })

  test('fetches photo addresses only over plain https', async () => {
    for (const imageUrl of [
      'http://photos.example/knit.jpg',
      'https://photos.example:8443/knit.jpg',
      'https://me:pw@photos.example/k.jpg',
    ])
      expect(jsonOf(await call('piece_add', { operationId: 'op-url-00001', imageUrl, type: 'tops' }))).toMatchObject({
        code: 'photo_refused',
        retryable: false,
      })
  })
})

describe('MCP authorization', () => {
  test.each([
    'https://claude.ai/api/mcp/auth_callback',
    'http://127.0.0.1:33418/callback',
    'http://localhost:6274/oauth',
  ])('lets a public client register the redirect %s', (uri) => expect(redirectUriAllowed(uri)).toBe(true))

  test.each([
    'http://evil.example/callback',
    'cursor://anysphere.cursor-retrieval/oauth',
    'https://ok.example/cb#frag',
    'not a url',
  ])('refuses to register the redirect %s', (uri) => expect(redirectUriAllowed(uri)).toBe(false))

  test('admits client metadata documents only from the hosted clients', () => {
    expect(hostedClientMetadata.has('https://claude.ai/oauth/mcp-oauth-client-metadata')).toBe(true)
    expect(hostedClientMetadata.has('https://claude.ai/oauth/other.json')).toBe(false)
  })

  test('challenges with the resource metadata and the one scope', () => {
    const metadata = 'https://styld.test/.well-known/oauth-protected-resource/mcp'
    expect(challenge(metadata)).toBe(`Bearer resource_metadata="${metadata}", scope="styld"`)
    expect(challenge(metadata, 'invalid_token')).toBe(
      `Bearer resource_metadata="${metadata}", scope="styld", error="invalid_token"`,
    )
  })
})

describe('curation for admins', () => {
  test('keeps its tools out of the members’ list, under noun_verb names', () => {
    const curation = Curation.of({
      targetOf: notUsed,
      featureBoard: notUsed,
      featureProfile: notUsed,
      markHouse: notUsed,
      hide: notUsed,
      reports: notUsed,
      checks: notUsed,
      rerun: notUsed,
    })
    const names = curationTools(curation).map(({ name }) => name)
    expect(names.toSorted()).toEqual(
      ['check_list', 'check_rerun', 'curation_feature', 'curation_hide', 'curation_house', 'report_list'].toSorted(),
    )
    for (const name of names) {
      expect([...toolNames]).not.toContain(name)
      expect(name).toMatch(/^[a-z]+_[a-z]+$/)
    }
  })

  test('knows an admin by the email they sign in with, in any case', () => {
    const admins = adminEmails(' Kris@Styld.app , ,ops@styld.app')
    expect([...admins]).toEqual(['kris@styld.app', 'ops@styld.app'])
    expect(isAdmin(admins, { email: 'KRIS@styld.app' })).toBe(true)
    expect(isAdmin(admins, { email: 'someone@styld.app' })).toBe(false)
    expect(isAdmin(admins, { email: null })).toBe(false)
    expect(isAdmin(adminEmails(undefined), { email: 'kris@styld.app' })).toBe(false)
  })
})

describe('every MCP tool', () => {
  test('takes the protocol’s arguments and reaches its operation', async () => {
    for (const name of toolNames) {
      const exit = await Effect.runPromiseExit(
        callTool(tools, name, everyCall[name]).pipe(
          Effect.provideService(CurrentAccount, CurrentAccount.of({ accountId: 'acc_1', via: 'assistant' })),
          Effect.provide(SignedMedia.layer(Redacted.make('native-test-signing-secret-32-characters'))),
        ),
      )
      // A fake these tests leave unused dies when reached: the arguments decoded and the tool ran.
      const reached = Exit.isSuccess(exit) ? jsonOf(exit.value) : 'reached its service'
      expect([name, reached]).not.toMatchObject([name, { code: 'invalid_arguments' }])
    }
  })
})
