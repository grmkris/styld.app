import { type Piece, PieceId, PieceNotFound } from '@styld/protocol'
import { Effect, Option } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import { describe, expect, test } from 'vitest'
import { CurrentAccount } from '../src/CurrentAccount.ts'
import { readResource, resources, viewsUri } from '../src/mcp/Resources.ts'
import { instructions, styldTools } from '../src/mcp/StyldTools.ts'
import { callTool, renderTools } from '../src/mcp/Tools.ts'
import type { D1 } from '../src/OAuth.ts'
import { challenge, hostedClientMetadata, redirectUriAllowed } from '../src/mcp/Policy.ts'
import { Wardrobe } from '../src/wardrobe/Wardrobe.ts'
import { Looks } from '../src/looks/Looks.ts'

const accountRow = { displayName: 'Ana Novak', email: 'ana@example.com' }
const database: D1 = {
  prepare: () => ({
    bind: () => ({
      // SAFETY: the fake database answers only the account_get query -- its row has exactly the displayName and email shape that query selects
      first: <T>() => Promise.resolve(accountRow as T),
      run: () => Promise.resolve({ meta: { changes: 0 } }),
    }),
  }),
}
const piece = (id: string, fields: Partial<Piece>): Piece => ({
  id: PieceId.make(`pc_${id.padEnd(22, '0')}`),
  name: null,
  notes: null,
  category: 'top',
  subcategory: null,
  colours: [],
  status: 'ready',
  source: 'website',
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
  ...fields,
})
const pieces = [
  piece('a', { name: 'Navy cable knit', colours: ['navy'] }),
  piece('b', { name: 'White tee', colours: ['white'] }),
  piece('c', { name: 'Jeans', category: 'bottom', subcategory: 'jeans', colours: ['blue', 'navy'] }),
]
/** Answers reads from three pieces; anything else is not part of these tests. */
const notUsed = () => Effect.die('not used by these tests')
const wardrobe = Wardrobe.of({
  listPieces: () => Effect.succeed(pieces),
  getPiece: notUsed,
  createUpload: notUsed,
  receiveUpload: notUsed,
  receiveVideoUpload: notUsed,
  pieceAddedBy: () => Effect.succeed(Option.none()),
  addPiece: notUsed,
  updatePiece: notUsed,
  deletePiece: notUsed,
  // The first piece has a thumbnail; the others cannot be read, and the view goes without them.
  pieceImage: (pieceId) =>
    Effect.gen(function* () {
      if (pieceId !== pieces[0]?.id) return yield* PieceNotFound.make({})
      return { body: new Blob(['webp']).stream(), contentType: 'image/webp', version: 'v1' }
    }),
  choosePicture: notUsed,
  processPiece: notUsed,
  failPiece: notUsed,
})
const offline = HttpClient.make(() => Effect.die('unit tests make no requests'))
/** Looks answer one saved look; anything else is not part of these tests. */
const looks = Looks.of({
  createLook: notUsed,
  listLooks: () => Effect.succeed([]),
  getLook: notUsed,
  deleteLook: notUsed,
})
const tools = styldTools(database, 'https://styld.test', { wardrobe, looks }, offline)
/** The JSON of a result's first text block. */
const jsonOf = (result: {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>
}): unknown => JSON.parse(result.content[0]?.text ?? 'null')
const call = (name: string, args: unknown) =>
  Effect.runPromise(
    callTool(tools, name, args).pipe(
      Effect.provideService(CurrentAccount, CurrentAccount.of({ accountId: 'acc_1', via: 'assistant' })),
    ),
  )

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
    expect(list.map(({ name }) => name)).toEqual([
      'account_get',
      'piece_search',
      'piece_get',
      'upload_create',
      'piece_add',
      'piece_update',
      'piece_delete',
      'wardrobe_show',
      'look_create',
      'look_list',
      'look_get',
      'look_delete',
    ])
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
        { name: 'Navy cable knit', category: 'top', url: `https://styld.test/wardrobe/${pieces[0]?.id}` },
        { name: 'White tee' },
        { name: 'Jeans', category: 'bottom' },
      ],
      labels: {
        en: { wardrobeTitle: 'Wardrobe', openInStyld: 'Open in Styld' },
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
  test('searches by words, category and colour, newest first, a page at a time', async () => {
    const navy = await call('piece_search', { colour: 'navy', limit: 1 })
    expect(navy.structuredContent).toMatchObject({
      pieces: [{ name: 'Navy cable knit', url: `https://styld.test/wardrobe/${pieces[0]?.id}` }],
      nextCursor: '1',
    })
    expect(await call('piece_search', { colour: 'navy', cursor: '1' })).toMatchObject({
      structuredContent: { pieces: [{ name: 'Jeans' }], nextCursor: null },
    })
    expect(await call('piece_search', { query: 'TEE' })).toMatchObject({
      structuredContent: { pieces: [{ name: 'White tee' }] },
    })
    expect(await call('piece_search', { category: 'bottom', query: 'tee' })).toMatchObject({
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
      category: 'top',
    })
    expect(jsonOf(both)).toMatchObject({ code: 'invalid_arguments' })
    expect(jsonOf(await call('piece_add', { operationId: 'op-none-0001', category: 'top' }))).toMatchObject({
      code: 'invalid_arguments',
    })
  })

  test('fetches photo addresses only over plain https', async () => {
    for (const imageUrl of [
      'http://photos.example/knit.jpg',
      'https://photos.example:8443/knit.jpg',
      'https://me:pw@photos.example/k.jpg',
    ])
      expect(jsonOf(await call('piece_add', { operationId: 'op-url-00001', imageUrl, category: 'top' }))).toMatchObject(
        {
          code: 'photo_refused',
          retryable: false,
        },
      )
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
