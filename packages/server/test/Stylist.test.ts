import { PieceId } from '@styld/protocol'
import { CanonicalRecordPayload } from '@yielded/agent/records'
import { DateTime, Effect, Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { tool, ToolError } from '../src/mcp/Tools.ts'
import { stylistDefinitions, accountOfThread, threadIdOf } from '../src/stylist/Agent.ts'
import { analysisOf } from '../src/stylist/Analysis.ts'
import { catalogue, modelSchema } from '../src/stylist/Catalogue.ts'
import { chatOf } from '../src/stylist/History.ts'
import { languageOf, outlineOf, systemPrompt } from '../src/stylist/Prompt.ts'
import { finishedReply } from '../src/stylist/Reply.ts'
import { operationOf, runTool, type ToolAccount } from '../src/stylist/Tools.ts'

const pieces = [
  { id: 'pc_navytrousers0000000000', name: 'Navy trousers', type: 'trousers', colours: ['navy'] },
  { id: 'pc_whitetee00000000000000', name: 'White tee', type: 'shortSleeveTops', colours: ['white'] },
  { id: 'pc_greyknit00000000000000', name: 'Grey knit', type: 'shortSleeveTops', colours: ['grey'] },
  { id: 'pc_whitesneakers000000000', name: 'White sneakers', type: 'trainers', colours: ['white'] },
]
const own = new Set(pieces.map(({ id }) => id))

const analysis = analysisOf(
  pieces.map(({ id, type, colours }) => ({
    id: PieceId.make(id),
    type: Schema.decodeUnknownSync(Schema.Literals(['trousers', 'shortSleeveTops', 'trainers']))(type),
    colours: Schema.decodeUnknownSync(Schema.Array(Schema.Literals(['navy', 'white', 'grey'])))(colours),
  })),
  { days: 60, pieceIds: ['pc_whitetee00000000000000', 'pc_whitetee00000000000000'] },
)

const lookCreate = tool({
  name: 'look_create',
  title: 'Put a look together',
  description: 'Save an outfit.',
  parameters: Schema.Struct({ operationId: Schema.String, name: Schema.String, pieceIds: Schema.Array(Schema.String) }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (input) => Effect.succeed({ id: `lk_${'a'.repeat(22)}`, name: input.name, operation: input.operationId }),
})
const refusing = tool({
  name: 'piece_get',
  title: 'A piece',
  description: 'One piece.',
  parameters: Schema.Struct({ pieceId: Schema.String }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: () =>
    Effect.fail(
      new ToolError({ code: 'not_found', message: 'No such piece.', recovery: 'Search first.', retryable: false }),
    ),
})

const account = (overrides: Partial<ToolAccount> = {}): ToolAccount => ({
  tools: [lookCreate, refusing],
  pieceIds: Effect.succeed(own),
  analyze: Effect.succeed({ analysis, names: new Map(pieces.map(({ id, name }) => [id, name])) }),
  ...overrides,
})

const call = (name: string, params: unknown, submissionId = 'sub-1', on = account()) =>
  Effect.runPromise(runTool(on, { submissionId, name, params }))

describe('the chat’s tools, as the model is offered them', () => {
  test('the six assistants’ tools and the chat’s two, each with how it may be repeated', () => {
    expect(catalogue.map(({ name, execution }) => [name, execution])).toEqual([
      ['pieces_show', 'readonly'],
      ['wardrobe_analyze', 'readonly'],
      ['piece_search', 'readonly'],
      ['piece_get', 'readonly'],
      ['outfit_make', 'readonly'],
      ['look_list', 'readonly'],
      ['look_get', 'readonly'],
      ['look_create', 'idempotent'],
    ])
    expect(stylistDefinitions.tools).toEqual(catalogue.map(({ name, execution }) => ({ name, execution })))
  })

  test('the model never sees operationId: the chat chooses it', () => {
    const { schema, operation } = modelSchema({
      type: 'object',
      properties: { operationId: { type: 'string' }, name: { type: 'string' } },
      required: ['operationId', 'name'],
    })
    expect(operation).toBe(true)
    expect(schema).toEqual({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] })
    const create = catalogue.find(({ name }) => name === 'look_create')
    expect(create?.operation).toBe(true)
    expect(JSON.stringify(create?.parameters)).not.toContain('operationId')
  })

  test('a chat’s Thread is named by the account and the chat, and names its account back', () => {
    expect(threadIdOf('acct_1', 'ch_2')).toBe('acct_1--ch_2')
    expect(accountOfThread('acct_1--ch_2')).toBe('acct_1')
    expect(accountOfThread('no-account')).toBe('')
  })
})

describe('a tool call the Thread asks for', () => {
  test('a write gets the operation id of its call: the same call repeated after an interruption saves once', async () => {
    const params = { name: 'Friday', pieceIds: ['pc_x'] }
    const first = await call('look_create', params)
    const again = await call('look_create', params)
    const elsewhere = await call('look_create', params, 'sub-2')
    const operation = await Effect.runPromise(operationOf('sub-1', 'look_create', params))
    expect(first).toMatchObject({ operation })
    expect(operation).toMatch(/^sq_[A-Za-z0-9_-]{40}$/u)
    expect(again).toEqual(first)
    expect(elsewhere).not.toEqual(first)
  })

  test('a refusal goes back to the model to act on, and a tool the chat does not offer is refused', async () => {
    expect(await call('piece_get', { pieceId: 'pc_x' })).toEqual({
      error: { code: 'not_found', message: 'No such piece.', recovery: 'Search first.' },
    })
    expect(await call('piece_delete', { pieceId: 'pc_x' })).toMatchObject({ error: { code: 'unknown_tool' } })
  })

  test('only the person’s own pieces are shown, each once, and a bad call is answered with what to fix', async () => {
    const [first] = pieces
    expect(await call('pieces_show', { pieceIds: [first?.id, 'pc_someoneelse00000000000', first?.id] })).toEqual({
      shown: [first?.id],
    })
    expect(await call('pieces_show', { pieceIds: [] })).toMatchObject({ error: { code: 'invalid_arguments' } })
  })

  test('the wardrobe counted: the card’s numbers, with the most worn pieces named for the model', async () => {
    const counted = await call('wardrobe_analyze', {})
    expect(counted).toMatchObject({
      pieces: 4,
      worn: { most: [{ pieceId: 'pc_whitetee00000000000000', piece: 'White tee' }] },
    })
    const failed = await call(
      'wardrobe_analyze',
      {},
      'sub-1',
      account({ analyze: Effect.fail('worn log unavailable') }),
    )
    expect(failed).toMatchObject({ error: { code: 'unavailable' } })
  })
})

const decodePayload = Schema.decodeUnknownSync(CanonicalRecordPayload)
const at = DateTime.makeUnsafe('2026-11-03T10:00:00.000Z')
const record = (payload: unknown) => ({ createdAt: at, payload: decodePayload(payload) })
const asked = (submissionId: string, text: string) =>
  record({
    _tag: 'UserInputRecorded',
    kind: 'user',
    submissionId,
    input: { text, language: 'en', today: '2026-11-03', outline: { pieces: 4, byType: {}, colours: [] } },
  })
const toolSettled = (toolName: string, result: unknown, isFailure = false) =>
  record({ _tag: 'ToolCallSettled', runId: 'run-1', toolCallId: `call-${toolName}`, toolName, result, isFailure })
const settled = (submissionId: string, outcome: 'completed' | 'aborted', result?: string) =>
  record({
    _tag: 'SubmissionSettled',
    submissionId,
    settlementId: `settled-${submissionId}`,
    receiptId: `receipt-${submissionId}`,
    outcome,
    ...(result === undefined ? {} : { result }),
  })

describe('a chat read from its Thread', () => {
  test('each message, and the reply with the cards its tools showed, from the recorded results', () => {
    const counted = {
      ...analysis,
      worn: { ...analysis.worn, most: [{ ...analysis.worn.most[0], piece: 'White tee' }] },
    }
    const chat = chatOf([
      asked('sub-1', 'What should I wear?'),
      toolSettled('piece_search', { pieces: [{ id: 'pc_greyknit00000000000000' }] }),
      toolSettled('pieces_show', { shown: ['pc_whitetee00000000000000'] }),
      toolSettled('look_create', { id: `lk_${'b'.repeat(22)}`, name: 'Friday', pieces: [] }),
      toolSettled('wardrobe_analyze', counted),
      toolSettled('pieces_show', { error: { code: 'unavailable' } }, true),
      settled('sub-1', 'completed', 'Wear the white tee. [shown: pc_greyknit00000000000000]'),
    ])
    expect(chat.replying).toBeUndefined()
    expect(chat.messages.map(({ role, text }) => [role, text])).toEqual([
      ['person', 'What should I wear?'],
      ['styld', 'Wear the white tee.'],
    ])
    expect(chat.messages[1]?.parts).toEqual([
      { _tag: 'Pieces', pieceIds: ['pc_whitetee00000000000000'] },
      { _tag: 'Look', lookId: `lk_${'b'.repeat(22)}`, name: 'Friday' },
      { _tag: 'Analysis', analysis },
      // A piece the reply only named in a note shows when its tools read it.
      { _tag: 'Pieces', pieceIds: ['pc_greyknit00000000000000'] },
    ])
  })

  test('a message being answered shows the reply being written; one that did not come shows it failed', () => {
    expect(chatOf([asked('sub-1', 'Hi')]).replying).toEqual({ state: 'writing', text: '', parts: [] })
    const failed = chatOf([asked('sub-1', 'Hi'), settled('sub-1', 'aborted')])
    expect(failed.replying).toEqual({ state: 'failed', text: '', parts: [] })
    expect(failed.messages.map(({ role }) => role)).toEqual(['person'])
    // The next message is answered afresh.
    expect(chatOf([asked('sub-1', 'Hi'), settled('sub-1', 'aborted'), asked('sub-2', 'Again')]).replying?.state).toBe(
      'writing',
    )
  })
})

describe('what Styld is told', () => {
  test('the date and season, the wardrobe in a line, and the person’s language; never an id', () => {
    const prompt = systemPrompt({ language: 'sl', today: '2026-01-12', outline: outlineOf(pieces) })
    expect(prompt).toContain('Today is 2026-01-12 (winter).')
    expect(prompt).toContain('The wardrobe holds 4 pieces: 1 trousers, 2 shortSleeveTops, 1 trainers.')
    expect(prompt).toContain('Write this reply in Slovenian')
    expect(prompt).toContain('informal singular ti')
    // The app's word for a look, and no gender chosen for the person (DESIGN.md › Copy and chrome).
    expect(prompt).toContain('a videz (plural videzi), as the app names it, never pogled')
    expect(prompt).toContain("Never choose the person's gender")
    expect(prompt).toContain('Speak of yourself in the present too (predlagam, svetujem)')
    expect(prompt).toContain('a cable knit is a pulover s kitami, never s kablom')
    expect(prompt).toContain('The type flats is balerinke (ballet flats and Mary Janes)')
    expect(systemPrompt({ language: 'en', today: '2026-07-01', outline: outlineOf(pieces) })).not.toContain(' ti,')
    expect(prompt).not.toMatch(/pc_/)
    expect(systemPrompt({ language: 'en', today: '2026-07-01', outline: outlineOf([]) })).toContain(
      'The wardrobe is empty',
    )
    expect(prompt).toContain('call wardrobe_analyze once')
  })

  test('one language for the reply, the latest message’s, never weighed by the model', () => {
    expect(languageOf('Kaj naj oblečem nocoj za večerjo v Ljubljani? Izberi kose iz moje garderobe.', 'en')).toBe('sl')
    expect(
      languageOf('Which jacket from my wardrobe should I wear over that outfit if it is cold? Please finish.', 'sl'),
    ).toBe('en')
    // Words that do not tell leave the app's language.
    expect(languageOf('Ok!', 'sl')).toBe('sl')
    expect(languageOf('', 'en')).toBe('en')
    const english = systemPrompt({ language: 'en', today: '2026-11-02', outline: outlineOf(pieces) })
    expect(english).toContain('Write this reply in English, whatever language earlier messages were in.')
    expect(english).toContain('never your thoughts about how to answer')
  })
})

describe('what the person reads (browser review, 2 November 2026)', () => {
  const first = PieceId.make('pc_navytrousers0000000000')
  // DeepSeek's answer on the preview, in kind: a note to itself on the language, the pieces as a written note (one of
  // them not the person's) instead of pieces_show, and a Chinese word inside English.
  const drafted = [
    'For a cold evening, the grey knit over the white tee works well with the navy trousers.',
    'Slovene answer maybe? User wrote in Slovene first, then English. Last message in English, so reply in English.',
    'You don’t own a真正 waterproof rain shell, so keep an umbrella handy.',
    `[shown: pc_greyknit00000000000000, pc_someoneelse00000000000, ${first}]`,
  ].join('\n\n')

  test('a reply that drafts aloud, writes its pieces as a note and slips script reads as finished advice', () => {
    const finished = finishedReply(drafted, [], own)
    expect(finished.text).toBe(
      [
        'For a cold evening, the grey knit over the white tee works well with the navy trousers.',
        'You don’t own a waterproof rain shell, so keep an umbrella handy.',
      ].join('\n\n'),
    )
    expect(finished.parts).toEqual([{ _tag: 'Pieces', pieceIds: ['pc_greyknit00000000000000', first] }])
  })

  test('pieces already shown are not shown twice, and a note naming none of theirs shows nothing', () => {
    const shown = [{ _tag: 'Pieces', pieceIds: [first] }] as const
    expect(finishedReply(`Wear it.\n\n[shown: ${first}]`, shown, own)).toEqual({ text: 'Wear it.', parts: shown })
    expect(finishedReply('Wear it. [shown: pc_someoneelse00000000000]', [], own)).toEqual({
      text: 'Wear it.',
      parts: [],
    })
  })

  test('a note still being written is hidden while the reply is shown in progress', () => {
    const { text } = finishedReply('Try the knit.\n\n[shown: pc_greykn', [], own)
    expect(text).toBe('Try the knit.')
  })
})
