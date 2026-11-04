import { expect } from 'bun:test'
import { encodePng } from '@styld/imaging'
import { ImportStarted, ImportStatus } from '@styld/protocol'
import { Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { type Call, client, seedAccounts, send, signIn } from './Accounts.ts'
import { nativeOperatorToken, operatorClient } from './OperatorToken.ts'

// Test-only acceptance: a v1 wardrobe imported through the public edge, as the operator's importer runs it. The
// operator starts it with the stage's operator token; the pieces land in the account the bundle's email signs in to,
// or in one made for it with a verified email and no password; starting it again imports nothing twice; to a signed-in
// person, a wrong token or no token at all the import is not there.

/** A picture of the bundle: a small PNG whose pixels vary. */
const picture = (shade: number) => {
  const size = 96
  const data = new Uint8Array(size * size * 4)
  for (let at = 0; at < data.length; at += 4) data.set([shade, (at / 4) % 251, 90, 255], at)
  return Base64.encode(encodePng({ width: size, height: size, data }))
}

/** Put a bundle of two pieces for `email` in the bucket, as `tools/import-v1/Import.ts` does; their v1 ids start
 * with `v1`. */
const bundle = async (testUrl: string, importId: string, email: string, v1 = importId) => {
  const response = await fetch(`${testUrl}/test/imports/bundle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      importId,
      manifest: {
        version: 1,
        email,
        displayName: 'Imported',
        pieces: [
          {
            v1Id: `${v1}-knit`,
            name: 'Wool jumper',
            type: 'knitwear',
            colours: ['beige'],
            picture: 'pictures/knit',
            contentType: 'image/png',
          },
          { v1Id: `${v1}-boots`, type: 'boots', colours: [], picture: 'pictures/boots', contentType: 'image/png' },
        ],
      },
      pictures: { 'pictures/knit': picture(200), 'pictures/boots': picture(40) },
    }),
  })
  expect(response.status).toBe(204)
}

const start = async (operator: Call, importId: string) => {
  const response = await send(operator, `/api/operator/imports/${importId}`, 'POST', {
    operationId: `start-${crypto.randomUUID()}`,
  })
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(ImportStarted)(await response.json())
}

/** The import once none of its pieces waits or processes. */
const settled = async (operator: Call, importId: string) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await operator(`/api/operator/imports/${importId}`)
    expect(response.status).toBe(200)
    const status = Schema.decodeUnknownSync(ImportStatus)(await response.json())
    if (status.pieces.every((piece) => piece.status === 'ready' || piece.status === 'failed')) return status
    await Bun.sleep(250)
  }
  throw new Error(`import ${importId} never settled`)
}

const accountRows = async (testUrl: string, email: string) =>
  Schema.decodeUnknownSync(
    Schema.Struct({
      accountId: Schema.String,
      enabled: Schema.Number,
      verified: Schema.Number,
      credentials: Schema.Number,
      emailCredentials: Schema.Number,
      passwords: Schema.Number,
    }),
  )(await (await fetch(`${testUrl}/test/imports/account?email=${encodeURIComponent(email)}`)).json())

const Pieces = Schema.Struct({
  // Every listed piece came from the import.
  pieces: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.NullOr(Schema.String),
      type: Schema.String,
      source: Schema.Literal('import'),
    }),
  ),
})

export const verifyImports = async (origin: string, testUrl: string) => {
  await seedAccounts(testUrl, 'native-import-owner', 'native-import-other')
  const operator = operatorClient(origin, nativeOperatorToken)
  const impostor = operatorClient(origin, `${nativeOperatorToken}-not`)
  const owner = client(origin, await signIn(origin, 'native-import-owner'))
  const other = client(origin, await signIn(origin, 'native-import-other'))

  // Into the account the email signs in to.
  await bundle(testUrl, 'native-import-owner-1', 'native-import-owner@example.invalid')
  // A signed-in person, a wrong token and no token at all find no import.
  expect((await send(other, '/api/operator/imports/native-import-owner-1', 'POST', {})).status).toBe(404)
  expect((await other('/api/operator/imports/native-import-owner-1')).status).toBe(404)
  expect((await impostor('/api/operator/imports/native-import-owner-1')).status).toBe(404)
  expect((await fetch(`${origin}/api/operator/imports/native-import-owner-1`)).status).toBe(404)
  const started = await start(operator, 'native-import-owner-1')
  expect(started).toMatchObject({ accountId: 'native-import-owner', accountCreated: false })
  const done = await settled(operator, 'native-import-owner-1')
  expect(done.pieces.map(({ status }) => status)).toEqual(['ready', 'ready'])
  const listed = Schema.decodeUnknownSync(Pieces)(await (await owner('/api/pieces')).json()).pieces
  expect(listed.map(({ name, type }) => ({ name, type })).toSorted((a, b) => a.type.localeCompare(b.type))).toEqual([
    { name: null, type: 'boots' },
    { name: 'Wool jumper', type: 'knitwear' },
  ])
  // Again, and from another bundle carrying the same v1 pieces: one receipt per v1 piece, nothing imported twice.
  const pieceIds = done.pieces.map(({ pieceId }) => pieceId)
  expect((await start(operator, 'native-import-owner-1')).pieces.map(({ pieceId }) => pieceId)).toEqual(pieceIds)
  await bundle(testUrl, 'native-import-owner-2', 'native-import-owner@example.invalid', 'native-import-owner-1')
  expect((await start(operator, 'native-import-owner-2')).pieces.map(({ pieceId }) => pieceId)).toEqual(pieceIds)
  expect(Schema.decodeUnknownSync(Pieces)(await (await owner('/api/pieces')).json()).pieces).toHaveLength(2)

  // Into an account made for an email nobody signed in with: a verified email, its credentials, no password.
  const email = 'native-import-new@example.invalid'
  await bundle(testUrl, 'native-import-new-1', email)
  const made = await start(operator, 'native-import-new-1')
  expect(made.accountCreated).toBe(true)
  expect(await accountRows(testUrl, email)).toEqual({
    accountId: made.accountId,
    enabled: 1,
    verified: 1,
    credentials: 1,
    emailCredentials: 1,
    passwords: 0,
  })
  expect((await settled(operator, 'native-import-new-1')).pieces.map(({ status }) => status)).toEqual([
    'ready',
    'ready',
  ])
  const remade = await start(operator, 'native-import-new-1')
  expect(remade).toMatchObject({ accountId: made.accountId, accountCreated: false })
}
