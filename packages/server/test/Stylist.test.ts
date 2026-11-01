import { readFileSync } from 'node:fs'
import { LookId } from '@styld/protocol'
import { Context, Effect, Layer, Predicate, Schema, Stream } from 'effect'
import { describe, expect, test } from 'vitest'
import { WorkersAi, workersAiModel } from '../src/ai/LanguageModel.ts'
import { CaptureMetrics } from '../src/capture/Metrics.ts'
import { type Tool as AssistantTool, tool, ToolError } from '../src/mcp/Tools.ts'
import { styldModel } from '../src/stylist/Policy.ts'
import { historyText, outlineOf, systemPrompt } from '../src/stylist/Prompt.ts'
import { lookingUpToolNames, modelSchema, showingToolNames, turnTools } from '../src/stylist/Tools.ts'
import { runTurn } from '../src/stylist/Turn.ts'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`fixtures/stylist/${name}`, import.meta.url), 'utf8'))

// The recording's wardrobe (fixtures/stylist/README.md).
const pieces = [
  { id: 'pc_navytrousers0000000000', name: 'Navy trousers', type: 'trousers', colours: ['navy'] },
  { id: 'pc_whitetee00000000000000', name: 'White tee', type: 'tops', colours: ['white'] },
  { id: 'pc_greyknit00000000000000', name: 'Grey knit', type: 'tops', colours: ['grey'] },
  { id: 'pc_whitesneakers000000000', name: 'White sneakers', type: 'trainers', colours: ['white'] },
]

const pieceSearch = tool({
  name: 'piece_search',
  title: 'Search the wardrobe',
  description: 'Pieces in the wardrobe, newest first, filtered by words, a garment type or a colour.',
  parameters: Schema.Struct({ query: Schema.optionalKey(Schema.String), type: Schema.optionalKey(Schema.String) }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: (input) =>
    Effect.succeed({
      pieces: pieces.filter((piece) => input.type === undefined || piece.type === input.type),
      nextCursor: null,
    }),
})

/** Styld's language model over Workers AI answering with the recorded answers in turn, keeping what it was asked and
 * the outcome and tokens of each counted call. */
const replaying = (answers: ReadonlyArray<unknown>) => {
  const asked: Array<Readonly<Record<string, unknown>>> = []
  const counted: Array<number> = []
  const failed: Array<number> = []
  const model = workersAiModel(styldModel).pipe(
    Layer.provide(
      WorkersAi.layer((_model, input) => {
        asked.push(input)
        return Promise.resolve(answers[asked.length - 1])
      }),
    ),
    Layer.provide(
      Layer.succeed(
        CaptureMetrics,
        CaptureMetrics.of({
          ...CaptureMetrics.discarding,
          call: ({ outcome, units }) => Effect.sync(() => void (outcome === 'ok' ? counted : failed).push(units)),
        }),
      ),
    ),
  )
  return { model, asked, counted, failed }
}

const Loose = Schema.Record(Schema.String, Schema.Unknown)
const loose = Schema.decodeUnknownSync(Loose)

/** A recorded answer with other words, or none. */
const saying = (answer: unknown, content: string): unknown => {
  const whole = loose(answer)
  const choices = Schema.decodeUnknownSync(Schema.Array(Loose))(whole['choices'])
  return {
    ...whole,
    choices: choices.map((choice) => ({ ...choice, message: { ...loose(choice['message']), content } })),
  }
}

/** One reply over the recorded wardrobe, the model answering with `answers` in turn. */
const replyWith = (answers: ReadonlyArray<unknown>, maxSteps = 6) => {
  const { model, asked, counted, failed } = replaying(answers)
  const progress: Array<string> = []
  const replied = Effect.runPromise(
    Effect.gen(function* () {
      const tools = yield* turnTools(
        [pieceSearch],
        { turnId: 'tn_test', pieceIds: new Set(pieces.map(({ id }) => id)) },
        Context.empty(),
      )
      const text = yield* runTurn({
        system: systemPrompt({ locale: 'en', today: '2026-10-31', outline: outlineOf(pieces) }),
        history: [{ role: 'person', text: 'What should I wear today? Something casual.' }],
        toolkit: yield* tools.toolkit.pipe(Effect.provide(tools.handlers)),
        maxSteps,
        showing: showingToolNames,
        lookingUp: lookingUpToolNames,
        progress: (sofar) => Effect.sync(() => progress.push(sofar)),
      })
      return { reply: text, parts: yield* tools.parts }
    }).pipe(Effect.provide(model)),
  )
  return { replied, asked, progress, counted, failed }
}

describe('a reply', () => {
  test('looks the wardrobe up, then ends with its words and the pieces it shows (recorded GLM-5.3-flash)', async () => {
    const recorded = [0, 1, 2].map((step) => fixture(`glm-step-${step}.json`))
    const { replied, asked, progress, counted } = replyWith(recorded)
    const { reply, parts } = await replied
    expect(reply).toMatch(/^For a casual autumn day, I'd go with your grey knit over a white tee/)
    // Its last recorded call only restated the answer: a call with words that only shows pieces ends the reply.
    expect(reply).not.toContain("It's an easy")
    // It showed all four pieces of the outfit, once.
    expect(parts).toHaveLength(1)
    const [shown] = parts
    expect(Predicate.isTagged(shown, 'Pieces') && [...shown.pieceIds].toSorted()).toEqual(
      pieces.map(({ id }) => id).toSorted(),
    )
    // Two model calls, each counted by its tokens in and out; the search's answer went back before the second.
    expect(counted).toHaveLength(2)
    expect(counted[0]).toBe(552)
    expect(asked).toHaveLength(2)
    expect(JSON.stringify(asked[1]?.['messages'])).toContain('pc_navytrousers0000000000')
    expect(progress.at(-1)).toBe(reply)
  })

  test('the same reply on DeepSeek V4.1 Flash: three searches at once, the pieces, then the words (recorded)', async () => {
    const { replied, asked } = replyWith([0, 1, 2].map((step) => fixture(`deepseek-step-${step}.json`)))
    const { reply, parts } = await replied
    expect(asked).toHaveLength(3)
    // Its first call said it would take a look while it searched: thinking aloud, left out.
    expect(reply).toMatch(/^Easy casual outfit for today: the white tee with your navy trousers and white sneakers\./)
    expect(reply).not.toContain('take a look')
    const [shown] = parts
    expect(Predicate.isTagged(shown, 'Pieces') && shown.pieceIds).toEqual([
      'pc_whitetee00000000000000',
      'pc_navytrousers0000000000',
      'pc_whitesneakers000000000',
    ])
  })

  test('pieces shown before any words: it goes on for the words', async () => {
    const shownFirst = saying(fixture('glm-step-1.json'), '')
    const { replied, asked } = replyWith([fixture('glm-step-0.json'), shownFirst, fixture('glm-step-2.json')])
    const { reply, parts } = await replied
    expect(asked).toHaveLength(3)
    expect(reply).toMatch(/^It's an easy, clean combination/)
    expect(parts).toHaveLength(1)
  })

  test('words written beside a search are thinking aloud, left out once it says something else', async () => {
    const aloud = saying(fixture('glm-step-0.json'), 'I’ll take a look at what’s in your wardrobe.')
    const { replied } = replyWith([aloud, fixture('glm-step-1.json')])
    const { reply } = await replied
    expect(reply).toMatch(/^For a casual autumn day/)
    // With nothing else said, they are the reply rather than none.
    const { replied: only } = replyWith([aloud], 1)
    expect((await only).reply).toBe('I’ll take a look at what’s in your wardrobe.')
  })

  test('a model that answers nothing readable fails the reply, and its call is counted as failed', async () => {
    const { replied, counted, failed } = replyWith([fixture('glm-step-0.json'), 'not a completion'])
    await expect(replied).rejects.toBeDefined()
    expect(counted).toEqual([552])
    expect(failed).toEqual([0])
  })

  test('stops after its last allowed call, keeping what it wrote', async () => {
    const { replied, asked } = replyWith([fixture('glm-step-0.json')], 1)
    const { reply, parts } = await replied
    expect(asked).toHaveLength(1)
    expect(reply).toBe('')
    expect(parts).toEqual([])
  })
})

/** Run one of a turn's tools as the model would call it, returning what the model reads back. */
const called = (
  assistants: ReadonlyArray<AssistantTool<never>>,
  name: string,
  params: unknown,
  pieceIds: ReadonlySet<string> = new Set(),
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tools = yield* turnTools(assistants, { turnId: 'tn_abc', pieceIds }, Context.empty())
      const kit = yield* tools.toolkit.pipe(Effect.provide(tools.handlers))
      const results = yield* kit.handle(name, params).pipe(Effect.flatMap(Stream.runCollect))
      return { result: results.at(-1)?.result, parts: yield* tools.parts }
    }),
  )

describe('a reply’s tools', () => {
  const lookCreate = tool({
    name: 'look_create',
    title: 'Put a look together',
    description: 'Save an outfit.',
    parameters: Schema.Struct({
      operationId: Schema.String,
      name: Schema.String,
      pieceIds: Schema.Array(Schema.String),
    }),
    annotations: { readOnlyHint: false, openWorldHint: false },
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

  test('the model never sees operationId; each writing call gets one of its own, and a saved look is shown', async () => {
    const { schema, operation } = modelSchema({
      type: 'object',
      properties: { operationId: { type: 'string' }, name: { type: 'string' } },
      required: ['operationId', 'name'],
    })
    expect(operation).toBe(true)
    expect(schema).toEqual({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] })
    const { result, parts } = await called([lookCreate], 'look_create', { name: 'Friday', pieceIds: ['pc_x'] })
    expect(result).toMatchObject({ operation: 'tn_abc-look_create-0' })
    expect(parts).toEqual([{ _tag: 'Look', lookId: `lk_${'a'.repeat(22)}`, name: 'Friday' }])
  })

  test('a reply written again saves its look under the same operation, whatever it looked up first', async () => {
    // The queue's second attempt at a reply: this time the model looks a piece up before it saves.
    const operations = await Effect.runPromise(
      Effect.gen(function* () {
        const ids: Array<unknown> = []
        for (const lookedUpFirst of [false, true]) {
          const tools = yield* turnTools(
            [lookCreate, refusing],
            { turnId: 'tn_abc', pieceIds: new Set() },
            Context.empty(),
          )
          const kit = yield* tools.toolkit.pipe(Effect.provide(tools.handlers))
          if (lookedUpFirst) yield* kit.handle('piece_get', { pieceId: 'pc_x' }).pipe(Effect.flatMap(Stream.runCollect))
          const saved = yield* kit
            .handle('look_create', { name: 'Friday', pieceIds: ['pc_x'] })
            .pipe(Effect.flatMap(Stream.runCollect))
          ids.push(Predicate.isObject(saved.at(-1)?.result) ? saved.at(-1)?.result : undefined)
        }
        return ids
      }),
    )
    expect(operations).toEqual([
      expect.objectContaining({ operation: 'tn_abc-look_create-0' }),
      expect.objectContaining({ operation: 'tn_abc-look_create-0' }),
    ])
  })

  test('a refusal goes back to the model to act on, and tools outside the stylist’s are left out', async () => {
    const { result } = await called([refusing], 'piece_get', { pieceId: 'pc_x' })
    expect(result).toEqual({ error: { code: 'not_found', message: 'No such piece.', recovery: 'Search first.' } })
    const tools = await Effect.runPromise(
      turnTools([{ ...refusing, name: 'piece_delete' }], { turnId: 'tn_abc', pieceIds: new Set() }, Context.empty()),
    )
    expect(Object.keys(tools.toolkit.tools).toSorted()).toEqual(['pieces_show'])
  })

  test('only the person’s own pieces are shown, and a bad call is answered with what to fix', async () => {
    const own = pieces[0]?.id ?? ''
    const shown = await called([], 'pieces_show', { pieceIds: [own, 'pc_someoneelse00000000000', own] }, new Set([own]))
    expect(shown.result).toEqual({ shown: 1 })
    expect(shown.parts).toEqual([{ _tag: 'Pieces', pieceIds: [own] }])
    const bad = await called([], 'pieces_show', { pieceIds: [] })
    expect(bad.result).toMatchObject({ error: { code: 'invalid_arguments' } })
    expect(bad.parts).toEqual([])
  })
})

describe('what Styld is told', () => {
  test('the date and season, the wardrobe in a line, and the person’s language; never an id', () => {
    const prompt = systemPrompt({ locale: 'sl', today: '2026-01-12', outline: outlineOf(pieces) })
    expect(prompt).toContain('Today is 2026-01-12 (winter).')
    expect(prompt).toContain('The wardrobe holds 4 pieces: 1 trousers, 2 tops, 1 trainers.')
    expect(prompt).toContain('Write in Slovenian')
    expect(prompt).toContain('informal singular ti')
    // The app's word for a look, and no gender chosen for the person (DESIGN.md › Copy and chrome).
    expect(prompt).toContain('a videz (plural videzi), as the app names it, never pogled')
    expect(prompt).toContain("Never choose the person's gender")
    expect(prompt).toContain('Speak of yourself in the present too (predlagam, svetujem)')
    expect(prompt).toContain('a cable knit is a pulover s kitami, never s kablom')
    expect(systemPrompt({ locale: 'en', today: '2026-07-01', outline: outlineOf(pieces) })).not.toContain(' ti,')
    expect(prompt).not.toMatch(/pc_/)
    expect(systemPrompt({ locale: 'en', today: '2026-07-01', outline: outlineOf([]) })).toContain(
      'The wardrobe is empty',
    )
  })

  test('an earlier reply is read back with what it showed and saved', () => {
    expect(
      historyText({
        role: 'styld',
        text: 'Try these.',
        parts: [
          { _tag: 'Pieces', pieceIds: [] },
          { _tag: 'Look', lookId: LookId.make(`lk_${'b'.repeat(22)}`), name: 'Friday' },
        ],
      }),
    ).toBe(`Try these.\n[shown: ]\n[saved the look lk_${'b'.repeat(22)}]`)
  })
})
