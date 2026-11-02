import { readFileSync } from 'node:fs'
import { Effect, Exit, Option, Redacted, Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { makeGarmentVision } from '../src/providers/Clef.ts'
import { gateFor, planFor } from '../src/capture/CleanPicture.ts'
import { cleanPrompt } from '../src/capture/CleanPrompt.ts'
import { CaptureMetrics } from '../src/kernel/Metrics.ts'
import { makeMuseGenerator } from '../src/providers/Muse.ts'
import { decodePng } from '@styld/imaging'
import { capturePolicy } from '../src/capture/Policy.ts'
import type { DrawRequest } from '../src/capture/Providers.ts'

const fixture = (name: string) => readFileSync(new URL(`fixtures/capture/${name}`, import.meta.url))
const cutout = { bytes: new Uint8Array(fixture('red-tee.png')), contentType: 'image/png' } as const
const request = (changes: Partial<DrawRequest> = {}): DrawRequest => ({
  front: cutout,
  back: Option.none(),
  key: 'green',
  hint: Option.none(),
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
  test('names the key colour, the back when there is one, and the owner’s words, kept to one short line', () => {
    const plain = cleanPrompt({ key: 'magenta', hasBack: false, hint: undefined })
    expect(plain).toContain('magenta #ff00ff')
    expect(plain).not.toContain('second image')
    expect(plain).toContain('no person, hands, body, mannequin, hanger')
    const hinted = cleanPrompt({ key: 'green', hasBack: true, hint: '  a black\n wool   beanie ' + 'x'.repeat(200) })
    expect(hinted).toContain('The second image is the back of the same garment')
    expect(hinted).toContain('Its owner describes it as: a black wool beanie x')
    expect(hinted).not.toContain('x'.repeat(80))
  })
})

describe('Meta Muse Image', () => {
  test('draws from the cut-outs alone, with Meta’s search tools off, and returns the PNG it drew', async () => {
    const { generator, seen } = muse(recorded)
    const back = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' } as const
    const drawn = await Effect.runPromise(
      generator.draw(request({ back: Option.some(back), hint: Option.some('linen') })),
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
    expect(edit.prompt).toContain('Its owner describes it as: linen.')
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

const policy = capturePolicy.pictures

describe('the decision model on a kept cut-out', () => {
  test('reads a clean drawn tee as ready, a scrap of a dress as a fragment, and no face in either', async () => {
    const ready = await Effect.runPromise(clef('clef-judge-red-tee.json').judge(cutout))
    expect(ready).toMatchObject({ verdict: 'ready' })
    expect(ready.face).toBeLessThan(0.05)
    const scrap = await Effect.runPromise(clef('clef-judge-dress-fragment.json').judge(cutout))
    expect(scrap.verdict).toBe('fragment')
  })

  test('reads how like the cut-out a drawing is: Muse turned the flat drawn tee into a photographed one', async () => {
    const compared = await Effect.runPromise(clef('clef-compare-red-tee.json').compare(cutout, cutout))
    expect(compared.same).toBeCloseTo(0.2827)
    expect(compared.faithful).toBeCloseTo(0.4404)
    expect(gateFor(compared, policy)).toBe('rejected')
  })

  test('assumes a face and a redraw when the answers are missing, so nothing unanswered is sent on', async () => {
    const blank = makeGarmentVision(
      () => Promise.resolve({ model: 'clef-flash', answers: {} }),
      CaptureMetrics.discarding,
    )
    const judged = await Effect.runPromise(blank.judge(cutout))
    expect(judged).toEqual({ verdict: 'improve', confidence: 0, face: 1 })
    expect(planFor(judged, policy)).toEqual({ plan: 'kept-real', reason: 'face' })
  })
})

/** A judgement of a kept cut-out, sure of `verdict`. */
const judged = (verdict: 'ready' | 'improve' | 'repair' | 'fragment', face = 0.01) => ({
  verdict,
  confidence: 0.9,
  face,
})

describe('what happens to a kept cut-out and to its drawing', () => {
  test('every whole one is drawn, clean or not, a fragment asks for a retake, a face sends nothing', () => {
    expect(planFor(judged('ready'), policy)).toEqual({ plan: 'draw' })
    expect(planFor(judged('ready', 0.3), policy)).toEqual({ plan: 'kept-real', reason: 'face' })
    expect(planFor(judged('improve'), policy)).toEqual({ plan: 'draw' })
    expect(planFor(judged('repair'), policy)).toEqual({ plan: 'draw' })
    expect(planFor(judged('fragment'), policy)).toEqual({ plan: 'retake' })
    expect(planFor(judged('improve', 0.3), policy)).toEqual({ plan: 'kept-real', reason: 'face' })
    expect(planFor(judged('improve', 0.29), policy)).toEqual({ plan: 'draw' })
  })

  test('a drawing is shown from 0.8, offered from 0.5, dropped below, by the weaker of its two answers', () => {
    expect(gateFor({ same: 0.8, faithful: 0.95 }, policy)).toBe('ready')
    expect(gateFor({ same: 0.95, faithful: 0.79 }, policy)).toBe('proposed')
    expect(gateFor({ same: 0.5, faithful: 0.9 }, policy)).toBe('proposed')
    expect(gateFor({ same: 0.49, faithful: 0.9 }, policy)).toBe('rejected')
  })
})
