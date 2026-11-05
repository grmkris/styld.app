import { describe, expect, it } from '@effect/vitest'
import {
  CurrentAccount,
  PhotoGarmentId,
  PhotoId,
  PieceId,
  type Photo,
  type StartTryOn,
  type TryOn,
  TryOnId,
} from '@styld/protocol'
import { Effect, Ref } from 'effect'
import { callTool } from '../src/tools/Tools.ts'
import { tryOnTools } from '../src/tools/TryOnTools.ts'

// The try-on tools assistants call: the person's word that the photo shows them is required before anything runs,
// and what comes back names Styld's pages, never a picture's address.

const photoId = PhotoId.make(`ph_${'a'.repeat(22)}`)
const pieceId = PieceId.make(`pc_${'c'.repeat(22)}`)
const tryOnId = TryOnId.make(`to_${'t'.repeat(22)}`)
const origin = 'https://styld.test'

const drawn: TryOn = {
  id: tryOnId,
  photoId,
  pieceIds: [pieceId],
  status: 'done',
  images: { thumb: '/cdn/media/secret/thumb', full: '/cdn/media/secret/full' },
  createdAt: '2026-11-04T19:00:00.000Z',
}
const photo: Photo = {
  id: photoId,
  status: 'ready',
  favourite: false,
  garments: [
    {
      id: PhotoGarmentId.make(`pg_${'g'.repeat(22)}`),
      type: 'jeans',
      colours: ['navy'],
      match: 'confirmed',
      pieceId,
      image: '/cdn/media/secret/garment',
    },
  ],
  lookId: null,
  hasCutout: false,
  images: { thumb: '/cdn/media/secret/thumb', full: '/cdn/media/secret/full' },
  createdAt: '2026-11-04T18:00:00.000Z',
}

const never = () => Effect.die('not used by these tests')

/** A result's JSON, read as nothing in particular until a test says what it holds. */
const parsed = (text: string): unknown => JSON.parse(text)

/** A result's first text block, as an assistant reads it. */
const textOf = (result: { readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }> }) =>
  result.content[0]?.text ?? ''

const over = Effect.gen(function* () {
  const started = yield* Ref.make<ReadonlyArray<StartTryOn>>([])
  const tools = tryOnTools(
    {
      start: (input) =>
        Effect.as(
          Ref.update(started, (all) => [...all, input]),
          { ...drawn, status: 'drawing' as const },
        ),
      get: () => Effect.succeed(drawn),
      list: () => Effect.succeed({ tryOns: [drawn] }),
      delete: never,
      toBoard: never,
    },
    { listPhotos: () => Effect.succeed([photo]) },
    origin,
  )
  const json = (name: string, args: unknown) =>
    callTool(tools, name, args).pipe(
      Effect.map((result) => ({ isError: result.isError === true, text: textOf(result) })),
      Effect.provideService(CurrentAccount, CurrentAccount.of({ accountId: 'ac_1', via: 'assistant' })),
    )
  return { started, json }
})

const ask = { operationId: 'mcp-try-on-1', photoId, pieceIds: [pieceId] }

describe('the try-on tools', () => {
  it.effect('start nothing unless the person said the photo shows them', () =>
    Effect.gen(function* () {
      const { started, json } = yield* over
      for (const args of [ask, { ...ask, thisIsMe: false }]) {
        const answer = yield* json('tryon_start', args)
        expect(answer.isError).toBe(true)
        expect(parsed(answer.text)).toMatchObject({ code: 'invalid_arguments' })
      }
      expect(yield* Ref.get(started)).toEqual([])
      const answer = yield* json('tryon_start', { ...ask, thisIsMe: true })
      expect(answer.isError).toBe(false)
      expect((yield* Ref.get(started)).length).toBe(1)
    }),
  )

  it.effect('answer with Styld’s pages, never a picture’s address', () =>
    Effect.gen(function* () {
      const { json } = yield* over
      for (const [name, args] of [
        ['tryon_start', { ...ask, thisIsMe: true }],
        ['tryon_get', { tryOnId }],
        ['tryon_list', {}],
        ['photo_list', {}],
      ] as const) {
        const answer = yield* json(name, args)
        expect(answer.isError).toBe(false)
        expect(answer.text).not.toContain('/cdn/')
      }
      expect(parsed((yield* json('tryon_get', { tryOnId })).text)).toMatchObject({
        status: 'done',
        url: `${origin}/try-on/${tryOnId}`,
        photoUrl: `${origin}/gallery/${photoId}`,
      })
      expect(parsed((yield* json('photo_list', {})).text)).toEqual({
        photos: [
          {
            id: photoId,
            createdAt: photo.createdAt,
            favourite: false,
            garments: [{ type: 'jeans', colours: ['navy'], match: 'confirmed', pieceId }],
            url: `${origin}/gallery/${photoId}`,
          },
        ],
      })
    }),
  )
})
