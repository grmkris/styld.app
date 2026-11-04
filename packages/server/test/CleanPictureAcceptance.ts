import { readFileSync } from 'node:fs'
import { expect } from 'bun:test'
import { Schema } from 'effect'
import { exists, processed, uploaded } from './CaptureAcceptance.ts'
import { PictureBackfilled } from '@styld/protocol'
import { backfillAccount, backfilled, colours, cutout, picturesAccount } from './PictureFixture.ts'
import { nativeOperatorToken } from './OperatorToken.ts'
import { type Call, client, send, signIn } from './Accounts.ts'

/** The API Worker's settings for clean pictures on the native stack: Clef and Muse are the fixture's stand-ins. */
const fixture = (name: string) => readFileSync(new URL(`fixtures/capture/${name}`, import.meta.url))

/** Muse's recorded drawing of the red tee on green, as PNG bytes. */
const museTee = () => {
  const recorded = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Struct({ data: Schema.Tuple([Schema.Struct({ b64_json: Schema.String })]) })),
  )(fixture('muse-edit-red-tee.json').toString('utf8'))
  return Uint8Array.from(atob(recorded.data[0].b64_json), (character) => character.charCodeAt(0))
}

const Picture = Schema.Struct({ state: Schema.String, shows: Schema.String, version: Schema.Number })
const Piece = Schema.Struct({ id: Schema.String, picture: Schema.optionalKey(Picture) })
const Reviewed = Schema.Struct({ pieceIds: Schema.Array(Schema.String) })
const Prompts = Schema.Struct({ prompts: Schema.Array(Schema.String) })
/** What the tray says of the account's credits today. */
export const Allowance = Schema.Struct({ allowance: Schema.Struct({ remaining: Schema.Number }) })

/** A 200 answer's body, decoded. */
export const decoded = async <A>(schema: Schema.Decoder<A>, response: Response) => {
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(schema)(await response.json())
}

/** The piece once its clean picture is no longer being drawn. */
const settled = async (call: Call, pieceId: string) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const piece = await decoded(Piece, await call(`/api/pieces/${pieceId}`))
    if (piece.picture?.state !== 'drawing') return piece
    await Bun.sleep(250)
  }
  throw new Error(`the picture of ${pieceId} is still being drawn`)
}

const redraw = (call: Call, pieceId: string, body: object) =>
  call(`/api/pieces/${pieceId}/picture/redraw`, { method: 'POST', body: JSON.stringify(body) })

/** The account's pieces, kept from the tray: a red tee to draw, a green shirt to draw on magenta, a blue scrap too
 * small to draw, and a piece kept as its photo. Each is a photo of its cut-out, which the native pipeline cuts out as
 * it is (`test/fakes/Garments.ts`). */
const keptPieces = async (origin: string, owner: Call) => {
  const pictures = [colours.red, colours.green, colours.blue, colours.red] as const
  const detections = []
  for (const [index, colour] of pictures.entries()) {
    const uploadId = await uploaded(owner, origin, cutout(colour), 'image/png')
    const created = await send(owner, '/api/captures', 'POST', {
      operationId: `native-pictures-capture-${index}`,
      uploadId,
      source: 'picker',
    })
    const { captureId } = Schema.decodeUnknownSync(Schema.Struct({ captureId: Schema.String }))(await created.json())
    const { capture } = await processed(owner, captureId)
    detections.push(capture.detections[0]?.id ?? '')
  }
  const [red = '', green = '', blue = '', photo = ''] = detections
  const reviewed = await send(owner, '/api/captures/review', 'POST', {
    operationId: 'native-pictures-review',
    keep: [
      ...[red, green, blue].map((detectionId) => ({ detectionId, type: 'shortSleeveTops' })),
      { detectionId: photo, type: 'shortSleeveTops', useOriginal: true },
    ],
    discard: [],
  })
  const [redPiece = '', greenPiece = '', bluePiece = '', photoPiece = ''] = (await decoded(Reviewed, reviewed)).pieceIds
  return { red: redPiece, green: greenPiece, blue: bluePiece, photo: photoPiece }
}

const BackImages = Schema.Struct({ images: Schema.Struct({ backClean: Schema.optionalKey(Schema.String) }) })

/** The piece's page once its back's drawing shows. */
const backDrawn = async (call: Call, pieceId: string) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const { images } = await decoded(BackImages, await call(`/api/pieces/${pieceId}`))
    if (images.backClean !== undefined) return images.backClean
    await Bun.sleep(250)
  }
  throw new Error(`the back of ${pieceId} was not drawn`)
}

/** A back added on the piece's page is free and drawn pressed, as the back, with the front for reference (owner, 4
 * November): signed on the piece's page once it is drawn, never checked against its cut-out; removing the back forgets its drawing. */
const verifyBackPicture = async (
  origin: string,
  fixtures: string,
  owner: Call,
  pieceId: string,
  prompts: () => Promise<ReadonlyArray<string>>,
) => {
  const before = await decoded(Allowance, await owner('/api/captures/tray'))
  const asked = (await prompts()).length
  const back = {
    operationId: 'native-back-picture-0001',
    uploadId: await uploaded(owner, origin, cutout(colours.red), 'image/png'),
  }
  expect((await send(owner, `/api/pieces/${pieceId}/back`, 'PUT', back)).status).toBe(200)
  const address = await backDrawn(owner, pieceId)
  expect((await fetch(`${origin}${address}`)).status).toBe(200)
  const sent = (await prompts()).slice(asked)
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('shown whole from the back')
  const drawing = `accounts/${picturesAccount}/pieces/${pieceId}/back-clean-1.png`
  expect(await exists(fixtures, drawing)).toBe(true)
  expect(await decoded(Allowance, await owner('/api/captures/tray'))).toEqual(before)
  expect((await owner(`/api/pieces/${pieceId}/back`, { method: 'DELETE' })).status).toBe(200)
  for (let attempt = 0; attempt < 120 && (await exists(fixtures, drawing)); attempt += 1) await Bun.sleep(250)
  expect(await exists(fixtures, drawing)).toBe(false)
  expect((await decoded(BackImages, await owner(`/api/pieces/${pieceId}`))).images.backClean).toBeUndefined()
}

/** Kept cut-outs get clean pictures through the queue: Clef judges each, Muse draws the ones worth drawing on their
 * key colour, the drawing is keyed, stored and shown, never compared with its cut-out (owner, 4 November); the owner's choice of their photo sticks. A redraw costs a credit once,
 * however often it is asked; a photo is never sent; deleting a piece deletes its drawings. Clef and Muse are the
 * fixture's stand-ins (PictureFixture.ts). The pieces it leaves are what `verifyTurn` turns. */
export const verifyCleanPictures = async (origin: string, fixtures: string) => {
  expect((await fetch(`${fixtures}/test/pictures/seed`, { method: 'POST' })).status).toBe(204)
  for (const [key, bytes] of [
    ['green', museTee()],
    ['magenta', new Uint8Array(fixture('muse-green-shirt.png'))],
  ] as const)
    expect((await fetch(`${fixtures}/test/pictures/answer?key=${key}`, { method: 'PUT', body: bytes })).status).toBe(
      204,
    )
  const owner = client(origin, await signIn(origin, picturesAccount))
  // Only this journey's drawings are counted: another's may have been asked for before it.
  const earlier = (await decoded(Prompts, await fetch(`${fixtures}/test/pictures/prompts`))).prompts.length
  const prompts = async () =>
    (await decoded(Prompts, await fetch(`${fixtures}/test/pictures/prompts`))).prompts.slice(earlier)
  // Keeping the three cut-outs queues a clean picture for each; the piece kept as its photo has none.
  const kept = await keptPieces(origin, owner)

  // The red tee is drawn and shows; the green shirt is drawn on magenta and shows too. Clef's stand-in sees a face in
  // every cut-out and answers a drawing beside its cut-out unavailable: neither is asked any more (owner, 4
  // November). The scrap asks for a retake and is never drawn; the photo has no picture.
  expect((await settled(owner, kept.red)).picture).toEqual({ state: 'ready', shows: 'clean', version: 1 })
  expect((await settled(owner, kept.green)).picture).toEqual({ state: 'ready', shows: 'clean', version: 1 })
  expect((await settled(owner, kept.blue)).picture).toEqual({ state: 'retake', shows: 'photo', version: 0 })
  expect((await settled(owner, kept.photo)).picture).toBeUndefined()
  const drawn = await prompts()
  expect(drawn).toHaveLength(2)
  expect(drawn.filter((prompt) => prompt.includes('magenta #ff00ff'))).toHaveLength(1)
  const tee = `accounts/${picturesAccount}/pieces/${kept.red}`
  expect(await exists(fixtures, `${tee}/clean-1.png`)).toBe(true)
  const PieceImages = Schema.Struct({
    images: Schema.Struct({ thumb: Schema.String, full: Schema.String, clean: Schema.optionalKey(Schema.String) }),
  })
  const imagesOf = async (pieceId: string) =>
    Schema.decodeUnknownSync(PieceImages)(await (await owner(`/api/pieces/${pieceId}`)).json()).images
  const red = await imagesOf(kept.red)
  for (const address of [red.full, red.clean ?? '']) expect((await fetch(`${origin}${address}`)).status).toBe(200)
  expect((await imagesOf(kept.blue)).clean).toBeUndefined()

  // The owner chooses their photo, and the choice sticks; then takes the drawing back. A scrap has none to take.
  const choose = (pieceId: string, use: 'clean' | 'photo') =>
    owner(`/api/pieces/${pieceId}/picture`, { method: 'PUT', body: JSON.stringify({ use }) })
  expect((await decoded(Piece, await choose(kept.green, 'photo'))).picture).toEqual({
    state: 'ready',
    shows: 'photo',
    version: 1,
  })
  expect((await decoded(Piece, await owner(`/api/pieces/${kept.green}`))).picture?.shows).toBe('photo')
  expect((await decoded(Piece, await choose(kept.green, 'clean'))).picture).toEqual({
    state: 'ready',
    shows: 'clean',
    version: 1,
  })
  expect((await choose(kept.blue, 'clean')).status).toBe(409)

  // A redraw holds a credit, sends the owner's words, replaces the drawing and consumes the credit once.
  const before = (await decoded(Allowance, await owner('/api/captures/tray'))).allowance.remaining
  // Two redraws asked at once: one claims the drawing and holds its credit; the other holds nothing and is told the
  // picture is busy, so it never settles the winner's hold.
  const hint = 'a red cotton tee'
  const ask = (operationId: string) => redraw(owner, kept.red, { operationId, hint })
  const raced = await Promise.all([ask('native-redraw-0001'), ask('native-redraw-0003')])
  expect(raced.map(({ status }) => status).toSorted((one, other) => one - other)).toEqual([200, 409])
  const [first, second] = raced
  const won = first?.status === 200 ? first : second
  expect(won === undefined ? 'none' : await decoded(Picture, won)).toEqual({
    state: 'drawing',
    shows: 'photo',
    version: 1,
  })
  expect((await ask(first?.status === 200 ? 'native-redraw-0001' : 'native-redraw-0003')).status).toBe(200)
  expect((await settled(owner, kept.red)).picture).toEqual({ state: 'ready', shows: 'clean', version: 2 })
  const sent = await prompts()
  expect(sent).toHaveLength(3)
  expect(sent.at(-1)).toContain('Its owner describes it as: a red cotton tee.')
  expect((await decoded(Allowance, await owner('/api/captures/tray'))).allowance.remaining).toBe(before - 1)
  expect(await exists(fixtures, `${tee}/clean-1.png`)).toBe(false)
  expect(await exists(fixtures, `${tee}/clean-2.png`)).toBe(true)
  // A photo never leaves Styld.
  expect((await redraw(owner, kept.photo, { operationId: 'native-redraw-0002' })).status).toBe(409)

  await verifyBackPicture(origin, fixtures, owner, kept.blue, prompts)

  // Deleting the piece deletes its drawing.
  expect((await owner(`/api/pieces/${kept.red}`, { method: 'DELETE' })).status).toBe(204)
  expect(await exists(fixtures, `${tee}/clean-2.png`)).toBe(false)
  return kept
}

/** Requests as the operator's script makes them: a bearer token, no cookie. */
const asOperator = (origin: string, token: string, body: object) =>
  fetch(`${origin}/api/operator/pictures/backfill`, {
    method: 'POST',
    headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** The operator's backfill (owner, 4 November): every ready cut-out of the account without a clean picture gets one
 * drawn on the queue, paid by Styld; a drawing proposed before then is shown; a photo and a piece still processing
 * are left; running it again queues nothing; to anyone without the operator's token it is not there. */
export const verifyBackfill = async (origin: string, fixtures: string) => {
  expect((await fetch(`${fixtures}/test/pictures/backfill/seed`, { method: 'POST' })).status).toBe(204)
  expect((await fetch(`${fixtures}/test/pictures/answer?key=green`, { method: 'PUT', body: museTee() })).status).toBe(
    204,
  )
  const owner = client(origin, await signIn(origin, backfillAccount))
  const email = { operationId: 'native-backfill-0001', email: `${backfillAccount}@example.invalid` }
  const earlier = (await decoded(Prompts, await fetch(`${fixtures}/test/pictures/prompts`))).prompts.length
  const before = (await decoded(Allowance, await owner('/api/captures/tray'))).allowance.remaining

  // A signed-in person, a wrong token and no token find nothing; an email nobody signs in with is not found.
  expect((await send(owner, '/api/operator/pictures/backfill', 'POST', email)).status).toBe(404)
  expect((await asOperator(origin, `${nativeOperatorToken}-not`, email)).status).toBe(404)
  expect(
    (
      await fetch(`${origin}/api/operator/pictures/backfill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(email),
      })
    ).status,
  ).toBe(404)
  expect(
    (
      await asOperator(origin, nativeOperatorToken, {
        operationId: 'native-backfill-0002',
        email: 'nobody@example.invalid',
      })
    ).status,
  ).toBe(404)

  const first = await decoded(PictureBackfilled, await asOperator(origin, nativeOperatorToken, email))
  expect(first).toEqual({ accountId: backfillAccount, queued: 1, shown: 1, remaining: 0 })
  // The proposed drawing shows at once; the undrawn piece is drawn on the queue and shows too.
  expect((await decoded(Piece, await owner(`/api/pieces/${backfilled.proposed}`))).picture).toEqual({
    state: 'ready',
    shows: 'clean',
    version: 1,
  })
  expect((await settled(owner, backfilled.undrawn)).picture).toEqual({ state: 'ready', shows: 'clean', version: 1 })
  expect((await decoded(Piece, await owner(`/api/pieces/${backfilled.photo}`))).picture).toBeUndefined()
  expect((await decoded(Piece, await owner(`/api/pieces/${backfilled.processing}`))).picture).toBeUndefined()

  // Again: nothing to queue or show, and Muse was asked once in all, never on the person's credits.
  // A repeat of the same operation is run again, not answered from a receipt: the picture rows are the receipt.
  const second = await decoded(PictureBackfilled, await asOperator(origin, nativeOperatorToken, email))
  expect(second).toEqual({ accountId: backfillAccount, queued: 0, shown: 0, remaining: 0 })
  const drawn = (await decoded(Prompts, await fetch(`${fixtures}/test/pictures/prompts`))).prompts.slice(earlier)
  expect(drawn).toHaveLength(1)

  // The prompt changed (4 November, pressed): the drawings that ended before a moment are drawn again, newest piece
  // first, each once however often the run is repeated with that moment, and still never on the person's credits.
  const moment = Date.now()
  const again = await decoded(
    PictureBackfilled,
    await asOperator(origin, nativeOperatorToken, { ...email, redrawBefore: moment }),
  )
  expect(again).toEqual({ accountId: backfillAccount, queued: 2, shown: 0, remaining: 0 })
  for (const pieceId of [backfilled.undrawn, backfilled.proposed])
    expect((await settled(owner, pieceId)).picture).toEqual({ state: 'ready', shows: 'clean', version: 2 })
  const repeated = await decoded(
    PictureBackfilled,
    await asOperator(origin, nativeOperatorToken, { ...email, redrawBefore: moment }),
  )
  expect(repeated).toEqual({ accountId: backfillAccount, queued: 0, shown: 0, remaining: 0 })
  expect(
    (await decoded(Prompts, await fetch(`${fixtures}/test/pictures/prompts`))).prompts.slice(earlier),
  ).toHaveLength(3)
  expect((await decoded(Allowance, await owner('/api/captures/tray'))).allowance.remaining).toBe(before)
}
