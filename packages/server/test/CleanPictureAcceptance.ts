import { readFileSync } from 'node:fs'
import { expect } from 'bun:test'
import { Schema } from 'effect'
import { exists, processed, uploaded } from './CaptureAcceptance.ts'
import { colours, cutout, picturesAccount } from './PictureFixture.ts'
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
      ...[red, green, blue].map((detectionId) => ({ detectionId, type: 'tops' })),
      { detectionId: photo, type: 'tops', useOriginal: true },
    ],
    discard: [],
  })
  const [redPiece = '', greenPiece = '', bluePiece = '', photoPiece = ''] = (await decoded(Reviewed, reviewed)).pieceIds
  return { red: redPiece, green: greenPiece, blue: bluePiece, photo: photoPiece }
}

/** Kept cut-outs get clean pictures through the queue: Clef judges each, Muse draws the ones worth drawing on their
 * key colour, the drawing is keyed, stored and checked, then shown, offered or dropped. A redraw costs a credit once,
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

  // The red tee is drawn and matches, so it shows; the green shirt is drawn on magenta and offered; the scrap asks
  // for a retake and is never drawn; the photo has no picture.
  expect((await settled(owner, kept.red)).picture).toEqual({ state: 'ready', shows: 'clean', version: 1 })
  expect((await settled(owner, kept.green)).picture).toEqual({ state: 'proposed', shows: 'photo', version: 1 })
  expect((await settled(owner, kept.blue)).picture).toEqual({ state: 'retake', shows: 'photo', version: 0 })
  expect((await settled(owner, kept.photo)).picture).toBeUndefined()
  const drawn = await prompts()
  expect(drawn).toHaveLength(2)
  expect(drawn.filter((prompt) => prompt.includes('magenta #ff00ff'))).toHaveLength(1)
  const tee = `accounts/${picturesAccount}/pieces/${kept.red}`
  expect(await exists(fixtures, `${tee}/clean-1.png`)).toBe(true)
  for (const which of ['full', 'photo/full', 'clean/full'])
    expect((await owner(`/cdn/pieces/${kept.red}/${which}`)).status).toBe(200)
  expect((await owner(`/cdn/pieces/${kept.blue}/clean/full`)).status).toBe(404)

  // The owner takes the offered drawing; a scrap has none to take.
  const choose = (pieceId: string) =>
    owner(`/api/pieces/${pieceId}/picture`, { method: 'PUT', body: JSON.stringify({ use: 'clean' }) })
  expect((await decoded(Piece, await choose(kept.green))).picture).toEqual({
    state: 'proposed',
    shows: 'clean',
    version: 1,
  })
  expect((await choose(kept.blue)).status).toBe(409)

  // A redraw holds a credit, sends the owner's words, replaces the drawing and consumes the credit once.
  const before = (await decoded(Allowance, await owner('/api/captures/tray'))).allowance.remaining
  const asked = { operationId: 'native-redraw-0001', hint: 'a red cotton tee' }
  expect(await decoded(Picture, await redraw(owner, kept.red, asked))).toEqual({
    state: 'drawing',
    shows: 'photo',
    version: 1,
  })
  expect((await redraw(owner, kept.red, asked)).status).toBe(200)
  expect((await settled(owner, kept.red)).picture).toEqual({ state: 'ready', shows: 'clean', version: 2 })
  const sent = await prompts()
  expect(sent).toHaveLength(3)
  expect(sent.at(-1)).toContain('Its owner describes it as: a red cotton tee.')
  expect((await decoded(Allowance, await owner('/api/captures/tray'))).allowance.remaining).toBe(before - 1)
  expect(await exists(fixtures, `${tee}/clean-1.png`)).toBe(false)
  expect(await exists(fixtures, `${tee}/clean-2.png`)).toBe(true)
  // A photo never leaves Styld.
  expect((await redraw(owner, kept.photo, { operationId: 'native-redraw-0002' })).status).toBe(409)

  // Deleting the piece deletes its drawing.
  expect((await owner(`/api/pieces/${kept.red}`, { method: 'DELETE' })).status).toBe(204)
  expect(await exists(fixtures, `${tee}/clean-2.png`)).toBe(false)
  return kept
}
