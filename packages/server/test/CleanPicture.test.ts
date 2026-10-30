import { readFileSync } from 'node:fs'
import { Effect, Exit, Option, Redacted, Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { cleanPrompt } from '../src/capture/CleanPrompt.ts'
import { CaptureMetrics } from '../src/capture/Metrics.ts'
import { makeMuseGenerator } from '../src/capture/Muse.ts'
import { decodePng } from '../src/capture/Pixels.ts'
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
    apiBase: 'https://meta.test',
    apiKey: Redacted.make('key'),
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
    expect(busy).toMatchObject({ _tag: 'ProviderFailed', provider: 'meta-muse', retryable: true })
    expect(throttled.seen).toHaveLength(4)
    const thenDrawn = muse(status(503), recorded)
    expect(Exit.isSuccess(await Effect.runPromiseExit(thenDrawn.generator.draw(request())))).toBe(true)
    const refused = muse(status(400))
    expect(await Effect.runPromise(Effect.flip(refused.generator.draw(request())))).toMatchObject({ retryable: false })
    expect(refused.seen).toHaveLength(1)
  })

  test('a picture the safety filter removed is a final refusal; an answer lost on the way is unknown', async () => {
    const removed = muse(() => Promise.resolve(new Response(JSON.stringify({ data: [] }))))
    expect(await Effect.runPromise(Effect.flip(removed.generator.draw(request())))).toMatchObject({
      _tag: 'ProviderFailed',
      retryable: false,
    })
    const lost = muse(() => Promise.reject(new Error('connection reset')))
    expect(await Effect.runPromise(Effect.flip(lost.generator.draw(request())))).toMatchObject({
      _tag: 'ProviderOutcomeUnknown',
      provider: 'meta-muse',
    })
    expect(lost.seen).toHaveLength(1)
  })
})
