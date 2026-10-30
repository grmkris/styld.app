import { readFileSync } from 'node:fs'
import { expect } from 'bun:test'
import { Schema } from 'effect'
import { type Call, client, signIn } from './WardrobeAcceptance.ts'

/** The daily allowance the native stack configures: a photo costs 1, a video 5 for each started
 * half-minute. Seven lets a long video's first part through and stops its second. */
export const nativeDailyAllowance = 7

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/capture/${name}`, import.meta.url)))

const post = (call: Call, path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body) })

const Created = Schema.Struct({ uploadId: Schema.String, path: Schema.String })

/** Upload bytes through a one-time upload path, as the website does. */
const uploaded = async (call: Call, origin: string, bytes: Uint8Array, contentType: string) => {
  const video = contentType.startsWith('video/')
  const created = await post(call, video ? '/api/uploads/video' : '/api/uploads', {
    contentType,
    bytes: bytes.byteLength,
  })
  expect(created.status).toBe(200)
  const { uploadId, path } = Schema.decodeUnknownSync(Created)(await created.json())
  const put = await fetch(`${origin}${path}`, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: new Blob([new Uint8Array(bytes)]),
  })
  expect(put.status).toBe(204)
  return uploadId
}

const Tray = Schema.Struct({
  captures: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
      detections: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          preselected: Schema.Boolean,
          hasCutout: Schema.Boolean,
          hasBack: Schema.Boolean,
        }),
      ),
    }),
  ),
  allowance: Schema.Struct({ remaining: Schema.Number, daily: Schema.Number }),
})

const tray = async (call: Call) => Schema.decodeUnknownSync(Tray)(await (await call('/api/captures/tray')).json())

/** The tray once the queue has processed `captureId`. */
const processed = async (call: Call, captureId: string) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const current = await tray(call)
    const capture = current.captures.find(({ id }) => id === captureId)
    if (capture !== undefined && capture.status !== 'processing') return { tray: current, capture }
    await Bun.sleep(250)
  }
  throw new Error(`capture ${captureId} is still processing`)
}

const captureId = async (response: Response) => {
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Schema.Struct({ captureId: Schema.String }))(await response.json()).captureId
}

/** Whether a stored object still exists, read through the fixture Worker. */
export const exists = async (fixtures: string, key: string) =>
  Schema.decodeUnknownSync(Schema.Struct({ exists: Schema.Boolean }))(
    await (await fetch(`${fixtures}/test/identity/media?key=${encodeURIComponent(key)}`)).json(),
  ).exists

/** A photo becomes one capture, waits in the tray for its owner only, and becomes a piece when kept. */
const verifyPhoto = async (origin: string, owner: Call, other: Call) => {
  // A photo becomes a capture once; the same operation id answers the same capture, or conflicts.
  const photo = await uploaded(owner, origin, fixture('red-tee.png'), 'image/png')
  const create = { operationId: 'native-capture-0001', uploadId: photo, source: 'picker' }
  const first = await captureId(await post(owner, '/api/captures', create))
  expect(await captureId(await post(owner, '/api/captures', create))).toBe(first)
  expect((await post(owner, '/api/captures', { ...create, source: 'camera' })).status).toBe(409)
  expect((await post(owner, '/api/captures', { ...create, operationId: 'native-capture-0002' })).status).toBe(422)
  expect((await post(other, '/api/captures', { ...create, operationId: 'native-capture-0003' })).status).toBe(422)

  const { capture } = await processed(owner, first)
  expect(capture).toMatchObject({ status: 'review', detections: [{ preselected: true, hasCutout: false }] })
  const detectionId = capture.detections[0]?.id ?? ''
  const picture = await owner(`/cdn/detections/${detectionId}/cutout`)
  expect(picture.status).toBe(200)
  expect(picture.headers.get('content-type')).toBe('image/png')
  expect(picture.headers.get('cache-control')).toContain('private')

  // Another account sees nothing of it and cannot decide it.
  expect((await other(`/cdn/detections/${detectionId}/cutout`)).status).toBe(404)
  expect((await tray(other)).captures).toEqual([])
  const keep = { detectionId, category: 'top', colours: ['red'], name: 'Red tee' }
  expect(
    (await post(other, '/api/captures/review', { operationId: 'native-review-0001', keep: [keep], discard: [] }))
      .status,
  ).toBe(404)
  expect((await other(`/api/captures/${first}`, { method: 'DELETE' })).status).toBe(404)

  // Keeping it makes a ready piece, once; the capture leaves the tray.
  const review = { operationId: 'native-review-0002', keep: [keep], discard: [] }
  const reviewed = await post(owner, '/api/captures/review', review)
  expect(reviewed.status).toBe(200)
  const { pieceIds } = Schema.decodeUnknownSync(Schema.Struct({ pieceIds: Schema.Array(Schema.String) }))(
    await reviewed.json(),
  )
  expect(pieceIds).toHaveLength(1)
  expect(await (await post(owner, '/api/captures/review', review)).json()).toEqual({ pieceIds })
  expect((await post(owner, '/api/captures/review', { ...review, operationId: 'native-review-0003' })).status).toBe(404)
  expect(await (await owner(`/api/pieces/${pieceIds[0]}`)).json()).toMatchObject({
    status: 'ready',
    category: 'top',
    name: 'Red tee',
  })
  expect((await owner(`/cdn/pieces/${pieceIds[0]}/thumb`)).status).toBe(200)
  expect((await tray(owner)).captures.find(({ id }) => id === first)).toBeUndefined()
  return { photo, first }
}

/** A short video and its stills cost five credits; the last free credit goes, then the day refuses more. */
const verifyAllowance = async (origin: string, owner: Call) => {
  // A 2-second video and its sampled still cost five credits (one started half-minute), and wait as the still.
  const video = await uploaded(owner, origin, fixture('tiny-rail.mp4'), 'video/mp4')
  const still = await uploaded(owner, origin, fixture('rail-frame.jpg'), 'image/jpeg')
  const clip = await captureId(
    await post(owner, '/api/captures/video', {
      operationId: 'native-video-0001',
      videoUploadId: video,
      durationMs: 2000,
      width: 160,
      height: 112,
      stills: [{ uploadId: still, atMs: 0, sharpness: Array.from({ length: 64 }, () => 0.5) }],
    }),
  )
  const afterVideo = await processed(owner, clip)
  expect(afterVideo.capture.detections).toHaveLength(1)
  expect(afterVideo.tray.allowance.remaining).toBe(nativeDailyAllowance - 6)

  // The last free credit goes, then the day's allowance refuses more until tomorrow.
  const last = await uploaded(owner, origin, fixture('blue-dress.png'), 'image/png')
  const lastCapture = await captureId(
    await post(owner, '/api/captures', { operationId: 'native-capture-0004', uploadId: last, source: 'camera' }),
  )
  const spare = await uploaded(owner, origin, fixture('green-shirt.png'), 'image/png')
  const refused = await post(owner, '/api/captures', {
    operationId: 'native-capture-0005',
    uploadId: spare,
    source: 'picker',
  })
  expect(refused.status).toBe(429)
  expect(await refused.json()).toMatchObject({ _tag: 'DailyLimitReached' })
  expect((await processed(owner, lastCapture)).tray.allowance.remaining).toBe(0)
  return { video, still, clip, last, lastCapture }
}

/** The tray once each front shot's piece has its back. */
const paired = async (call: Call, fronts: ReadonlyArray<string>) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const current = await tray(call)
    const backed = fronts.every((front) =>
      current.captures.some(({ id, detections }) => id === front && detections.some(({ hasBack }) => hasBack)),
    )
    if (backed) return current
    await Bun.sleep(250)
  }
  throw new Error(`a back shot of ${fronts.join(', ')} was not paired`)
}

/** A camera's back shot becomes the back of its front shot's piece, whether the front was in the tray
 * first or the two finished together; removing the front removes its back's photo. */
const verifyPairing = async (origin: string, fixtures: string, call: Call) => {
  const shot = async (operationId: string, name: string, side: 'front' | 'back', pairsWith?: string) => {
    const uploadId = await uploaded(call, origin, fixture(name), 'image/png')
    const created = await post(call, '/api/captures', {
      operationId,
      uploadId,
      source: 'camera',
      side,
      ...(pairsWith === undefined ? {} : { pairsWith }),
    })
    return { uploadId, captureId: await captureId(created) }
  }
  const front = await shot('native-pair-0001', 'red-tee.png', 'front')
  await processed(call, front.captureId)
  const back = await shot('native-pair-0002', 'green-shirt.png', 'back', front.captureId)
  // Sent one after the other, as the camera sends them: either may finish first.
  const second = await shot('native-pair-0003', 'blue-dress.png', 'front')
  const secondBack = await shot('native-pair-0004', 'green-shirt.png', 'back', second.captureId)
  const current = await paired(call, [front.captureId, second.captureId])
  expect(current.captures.map(({ id }) => id).toSorted()).toEqual([front.captureId, second.captureId].toSorted())
  expect(current.allowance.remaining).toBe(nativeDailyAllowance - 4)
  const detectionId = current.captures.find(({ id }) => id === front.captureId)?.detections[0]?.id ?? ''
  const picture = await call(`/cdn/detections/${detectionId}/back`)
  expect(picture.status).toBe(200)
  expect(new Uint8Array(await picture.arrayBuffer())).toEqual(fixture('green-shirt.png'))

  const me = Schema.decodeUnknownSync(Schema.Struct({ accountId: Schema.String }))(await (await call('/api/me')).json())
  const key = (uploadId: string) => `accounts/${me.accountId}/uploads/${uploadId}`
  for (const [shotFront, shotBack] of [
    [front, back],
    [second, secondBack],
  ] as const) {
    expect((await call(`/api/captures/${shotFront.captureId}`, { method: 'DELETE' })).status).toBe(204)
    expect(await exists(fixtures, key(shotFront.uploadId))).toBe(false)
    expect(await exists(fixtures, key(shotBack.uploadId))).toBe(false)
  }
  expect((await tray(call)).captures).toEqual([])
}

/** A photo and a video become captures that wait in the tray, only for their owner, and become pieces
 * when reviewed. Each costs today's free credits until they run out; removing a capture deletes its
 * photos. Providers are off natively, so each capture keeps its original photo as one detection. */
export const verifyCaptures = async (origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-capture`, { method: 'POST' })).status).toBe(204)
  const owner = client(origin, await signIn(origin, 'native-capture'))
  const other = client(origin, await signIn(origin, 'native-capture-other'))
  expect((await fetch(`${origin}/api/captures/tray`)).status).toBe(401)
  expect(await tray(owner)).toEqual({
    captures: [],
    allowance: { remaining: nativeDailyAllowance, daily: nativeDailyAllowance },
  })
  const { photo, first } = await verifyPhoto(origin, owner, other)
  const { video, still, clip, last, lastCapture } = await verifyAllowance(origin, owner)
  await verifyPairing(origin, fixtures, other)

  // Removing captures deletes their photos and the video's stills; a kept piece's photo stays.
  const me = Schema.decodeUnknownSync(Schema.Struct({ accountId: Schema.String }))(
    await (await owner('/api/me')).json(),
  )
  const key = (uploadId: string) => `accounts/${me.accountId}/uploads/${uploadId}`
  expect(await exists(fixtures, key(video))).toBe(true)
  // A capture whose pieces were kept stays: those pieces show its pictures.
  expect((await owner(`/api/captures/${first}`, { method: 'DELETE' })).status).toBe(404)
  expect((await owner(`/api/captures/${clip}`, { method: 'DELETE' })).status).toBe(204)
  expect((await owner(`/api/captures/${lastCapture}`, { method: 'DELETE' })).status).toBe(204)
  expect(await exists(fixtures, key(video))).toBe(false)
  expect(await exists(fixtures, key(still))).toBe(false)
  expect(await exists(fixtures, key(last))).toBe(false)
  expect(await exists(fixtures, key(photo))).toBe(true)
  expect((await tray(owner)).captures).toEqual([])
}
