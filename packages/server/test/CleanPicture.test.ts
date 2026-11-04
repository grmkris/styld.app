import { readFileSync } from 'node:fs'
import { Effect, Exit, Option, Redacted, Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { makeGarmentVision } from '../src/providers/Clef.ts'
import { planFor } from '../src/capture/CleanPicture.ts'
import { cleanPrompt } from '../src/capture/CleanPrompt.ts'
import { CaptureMetrics } from '../src/kernel/Metrics.ts'
import { makeMuseGenerator } from '../src/providers/Muse.ts'
import { decodePng } from '@styld/imaging'
import type { DrawRequest } from '../src/capture/Providers.ts'
import type { PieceType } from '@styld/protocol'

const fixture = (name: string) => readFileSync(new URL(`fixtures/capture/${name}`, import.meta.url))
const cutout = { bytes: new Uint8Array(fixture('red-tee.png')), contentType: 'image/png' } as const
const request = (changes: Partial<DrawRequest> = {}): DrawRequest => ({
  side: 'front',
  subject: cutout,
  other: Option.none(),
  photo: Option.none(),
  type: 'shortSleeveTops',
  colours: ['red'],
  key: 'green',
  hint: Option.none(),
  ...changes,
})

/** The prompt for a front of `type` drawn from its cut-out alone. */
const frontPrompt = (type: PieceType, changes: Partial<Parameters<typeof cleanPrompt>[0]> = {}) =>
  cleanPrompt({
    key: 'green',
    side: 'front',
    type,
    colours: ['grey'],
    fromPhoto: false,
    hasOther: false,
    hint: undefined,
    ...changes,
  })

/** Muse answering each call in turn, and the requests it saw. */
const muse = (...answers: ReadonlyArray<() => Promise<Response>>) => {
  const seen: Array<{ readonly url: string; readonly init: RequestInit }> = []
  const generator = makeMuseGenerator({
    base: 'https://meta.test',
    key: Redacted.make('key'),
    fetch: (url, init) => {
      seen.push({ url, init })
      const next = answers[Math.min(seen.length - 1, answers.length - 1)]
      return next === undefined ? Promise.reject(new Error('no answer')) : next()
    },
    metrics: CaptureMetrics.discarding,
  })
  return { generator, seen }
}

const recorded = () => Promise.resolve(new Response(fixture('muse-edit-red-tee.json')))
const status = (code: number) => () => Promise.resolve(new Response('{}', { status: code }))
/** The JSON a Muse request carried: its prompt and the pictures, as data URLs. */
const SentEdit = Schema.fromJsonString(
  Schema.Struct({ prompt: Schema.String, images: Schema.Array(Schema.Struct({ image_url: Schema.String })) }),
)
const sentBody = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? JSON.parse(init.body) : undefined

describe('the clean picture prompt', () => {
  test('names the key colour, the back when there is one, and the owner’s correction first, kept to one short line', () => {
    const plain = frontPrompt('shortSleeveTops', { key: 'magenta' })
    expect(plain).toContain('magenta #ff00ff')
    expect(plain).not.toContain('second image')
    expect(plain).toContain('no person, hands, body, visible mannequin, hanger')
    const hinted = frontPrompt('hats', { hasOther: true, hint: '  a black\n wool   beanie ' + 'x'.repeat(200) })
    expect(hinted).toContain('The second image is the back of the same garment')
    expect(hinted).toContain(
      'Its owner says what to correct, and this comes before everything else: a black wool beanie x',
    )
    expect(hinted).not.toContain('x'.repeat(80))
  })

  test('a back is drawn as the back, with its front for colour and identity only (owner, 4 November)', () => {
    const back = frontPrompt('knitwear', { side: 'back', hasOther: true })
    expect(back).toContain('shown whole from the back')
    expect(back).toContain('The second image is the front of the same garment, for its colours and identity only')
    expect(back).toContain('freshly steamed')
    expect(frontPrompt('knitwear', { side: 'back' })).not.toContain('second image')
  })

  test('a garment is a gentle ghost mannequin: its snapshot outline never traced, its cut and details kept (owner, 4 November)', () => {
    const knit = frontPrompt('knitwear')
    expect(knit).toMatch(
      /^Create a ghost-mannequin e-commerce product photo of this garment: shown whole from the front/,
    )
    expect(knit).toContain('Keep the garment’s own cut, width, length and proportions exactly: do not add bust shaping')
    expect(knit).toContain('accidents of how it lay, not its design. Never trace its silhouette.')
    expect(knit).toContain('freshly steamed')
    expect(knit).toContain('unless the garment is asymmetric by design')
    expect(knit).toContain('crossed or twisted straps')
    // The wording that let Muse trace a crumpled snapshot is gone.
    expect(knit).not.toContain('exactly as the reference shows them, such as ties')
    expect(knit).not.toContain('laid out evenly')
  })

  test('shoes and bags are drawn from the angle their cut-out shows, never turned to face the front', () => {
    for (const type of ['outdoorShoes', 'boots', 'sandals', 'trainers', 'heels', 'bags'] as const) {
      const prompt = frontPrompt(type)
      expect(prompt).toContain('from the same angle as the reference shows it (a side view stays a side view)')
      expect(prompt).not.toContain('from the front')
      expect(prompt).not.toContain('ghost-mannequin')
    }
    expect(frontPrompt('bags')).toContain('a soft or slouchy shape stays soft and slouchy')
    expect(frontPrompt('scarves')).toContain('shown whole from the front')
  })

  test('after a refusal, names the garment the cut-out marks in the photo that comes first', () => {
    const prompt = frontPrompt('sleevelessTops', { fromPhoto: true })
    expect(prompt).toMatch(
      /^The first image is a photo that may show a person or several things; the second image is a rough cut-out of the grey sleeveless top from it/,
    )
    expect(prompt).toContain(
      'Create a ghost-mannequin e-commerce product photo of the grey sleeveless top from the first image:',
    )
    expect(frontPrompt('jeans', { fromPhoto: true, colours: [] })).toContain('a rough cut-out of the jeans from it')
    expect(frontPrompt('jeans')).not.toContain('first image is a photo')
  })
})

describe('Meta Muse Image', () => {
  test('draws from the cut-outs alone, with Meta’s search tools off, and returns the PNG it drew', async () => {
    const { generator, seen } = muse(recorded)
    const back = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' } as const
    const drawn = await Effect.runPromise(
      generator.draw(request({ other: Option.some(back), hint: Option.some('linen') })),
    )
    const picture = decodePng(drawn.bytes)
    expect([picture.width, picture.height, drawn.contentType]).toEqual([240, 360, 'image/png'])
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('https://meta.test/v1/images/edits')
    expect(new Headers(seen[0]?.init.headers).get('authorization')).toBe('Bearer key')
    const body = sentBody(seen[0]?.init)
    expect(body).toMatchObject({
      model: 'muse-image-1.0',
      n: 1,
      size: '1024x1536',
      output_format: 'png',
      response_format: 'b64_json',
      tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
    })
    const edit = Schema.decodeUnknownSync(SentEdit)(seen[0]?.init.body)
    expect(edit.images.map(({ image_url }) => image_url.slice(0, 22))).toEqual([
      'data:image/png;base64,',
      'data:image/jpeg;base64',
    ])
    expect(edit.prompt).toContain('Its owner says what to correct, and this comes before everything else: linen.')
  })

  test('after a refusal, sends the photo first and the cut-out second, without the back', async () => {
    const { generator, seen } = muse(recorded)
    const photo = { bytes: new Uint8Array([7, 7]), contentType: 'image/webp' } as const
    const back = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' } as const
    await Effect.runPromise(generator.draw(request({ photo: Option.some(photo), other: Option.some(back) })))
    const edit = Schema.decodeUnknownSync(SentEdit)(seen[0]?.init.body)
    expect(edit.images.map(({ image_url }) => image_url.slice(0, 22))).toEqual([
      'data:image/webp;base64',
      'data:image/png;base64,',
    ])
    expect(edit.prompt).toContain('a rough cut-out of the red t-shirt from it')
    expect(edit.prompt).not.toContain('The second image is the back')
  })

  test('tries again in place when throttled, then leaves it to the queue; a refusal is final', async () => {
    const throttled = muse(status(429))
    const busy = await Effect.runPromise(Effect.flip(throttled.generator.draw(request())))
    expect(busy).toMatchObject({ _tag: 'ProviderError', provider: 'meta-muse', reason: { _tag: 'Busy' } })
    expect(throttled.seen).toHaveLength(4)
    const thenDrawn = muse(status(503), recorded)
    expect(Exit.isSuccess(await Effect.runPromiseExit(thenDrawn.generator.draw(request())))).toBe(true)
    const refused = muse(status(400))
    expect(await Effect.runPromise(Effect.flip(refused.generator.draw(request())))).toMatchObject({
      reason: { _tag: 'Refused' },
    })
    expect(refused.seen).toHaveLength(1)
  })

  test('a picture the safety filter removed is a final refusal; an answer lost on the way is unknown', async () => {
    const removed = muse(() => Promise.resolve(new Response(JSON.stringify({ data: [] }))))
    expect(await Effect.runPromise(Effect.flip(removed.generator.draw(request())))).toMatchObject({
      _tag: 'ProviderError',
      reason: { _tag: 'Refused' },
    })
    const lost = muse(() => Promise.reject(new Error('connection reset')))
    expect(await Effect.runPromise(Effect.flip(lost.generator.draw(request())))).toMatchObject({
      _tag: 'ProviderError',
      reason: { _tag: 'OutcomeUnknown' },
      provider: 'meta-muse',
    })
    expect(lost.seen).toHaveLength(1)
  })
})

/** Clef answering with a recorded answer. */
const clef = (name: string) =>
  makeGarmentVision(() => Promise.resolve(JSON.parse(fixture(name).toString('utf8'))), CaptureMetrics.discarding)

describe('the decision model on a kept cut-out', () => {
  test('reads a clean drawn tee as ready and a scrap of a dress as a fragment', async () => {
    const ready = await Effect.runPromise(clef('clef-judge-red-tee.json').judge(cutout))
    expect(ready).toMatchObject({ verdict: 'ready' })
    const scrap = await Effect.runPromise(clef('clef-judge-dress-fragment.json').judge(cutout))
    expect(scrap.verdict).toBe('fragment')
  })

  test('is not asked whether a face shows, and a cut-out it would have seen one in is drawn (owner, 4 November)', async () => {
    const asked: Array<ReadonlyArray<string>> = []
    const seeing = makeGarmentVision((asking) => {
      asked.push(Object.keys(asking.questions))
      return Promise.resolve({
        model: 'clef-flash',
        answers: {
          picture: { type: 'choice', choice: 'improve', probabilities: { improve: 0.9, fragment: 0.1 } },
          face: { type: 'noul', noul: 0.97 },
        },
      })
    }, CaptureMetrics.discarding)
    const judged = await Effect.runPromise(seeing.judge(cutout))
    expect(asked).toEqual([['picture']])
    expect(planFor(judged)).toBe('draw')
  })

  test('takes a missing answer for a cut-out to redraw, so it is drawn', async () => {
    const blank = makeGarmentVision(
      () => Promise.resolve({ model: 'clef-flash', answers: {} }),
      CaptureMetrics.discarding,
    )
    const judged = await Effect.runPromise(blank.judge(cutout))
    expect(judged).toEqual({ verdict: 'improve', confidence: 0 })
    expect(planFor(judged)).toBe('draw')
  })
})

/** A judgement of a kept cut-out, sure of `verdict`. */
const judged = (verdict: 'ready' | 'improve' | 'repair' | 'fragment') => ({ verdict, confidence: 0.9 })

describe('what happens to a kept cut-out', () => {
  test('every whole one is drawn, clean or not, and a fragment asks for a retake', () => {
    expect(planFor(judged('ready'))).toBe('draw')
    expect(planFor(judged('improve'))).toBe('draw')
    expect(planFor(judged('repair'))).toBe('draw')
    expect(planFor(judged('fragment'))).toBe('retake')
  })
})
