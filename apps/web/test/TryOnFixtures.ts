import { Chat, OperationId, Photo, TryOn } from '@styld/protocol'
import { Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import * as TryOnPage from '../src/page/TryOn.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

// The person's Gallery photo, two pieces and their try-ons as the server answers them, for Try on's tests.

export const tee = pieceFixture('tee', { type: 'shortSleeveTops', name: 'White tee' })
export const jeans = pieceFixture('jeans', { type: 'jeans', name: 'Blue jeans' })

export const photo = Schema.decodeUnknownSync(Photo)({
  id: `ph_${'mirror'.padEnd(22, 'x')}`,
  status: 'ready',
  favourite: false,
  garments: [],
  lookId: null,
  hasCutout: false,
  images: { thumb: '/cdn/signed/photo-thumb', full: '/cdn/signed/photo-full' },
  createdAt: '2026-10-31T10:00:00.000Z',
})

/** A second Gallery photo, tried on before in one test. */
export const otherPhoto = Schema.decodeUnknownSync(Photo)({
  id: `ph_${'window'.padEnd(22, 'x')}`,
  status: 'ready',
  favourite: false,
  garments: [],
  lookId: null,
  hasCutout: false,
  images: { thumb: '/cdn/signed/other-thumb', full: '/cdn/signed/other-full' },
  createdAt: '2026-10-30T10:00:00.000Z',
})

export const tryOnOf = (fields: object = {}) =>
  Schema.decodeUnknownSync(TryOn)({
    id: `to_${'first'.padEnd(22, 'x')}`,
    photoId: photo.id,
    pieceIds: [tee.id, jeans.id],
    status: 'drawing',
    createdAt: '2026-11-04T20:00:00.000Z',
    ...fields,
  })

export const drawing = tryOnOf()
export const done = tryOnOf({
  status: 'done',
  images: { thumb: '/cdn/signed/try-on-thumb', full: '/cdn/signed/try-on-full' },
})

export const lostOperation = Schema.decodeUnknownSync(OperationId)('lost-answer-0001')

/** The page with its try-ons, the Gallery's photo and no looks read. */
export const loaded = (tryOns: ReadonlyArray<TryOn>, model: TryOnPage.Model = TryOnPage.init()): TryOnPage.Model =>
  modifyFields(model, {
    tryOns: () => TryOnPage.TryOnsData.Success({ data: tryOns }),
    choices: () => TryOnPage.ChoicesData.Success({ data: { photos: [photo, otherPhoto], looks: [] } }),
  })

const chatId = `ch_${'tryon'.padEnd(22, 'x')}`

/** A chat with Styld whose reply names these parts (try-ons, for the chat's try-on cards). */
export const chatNaming = (parts: ReadonlyArray<object>) =>
  Schema.decodeUnknownSync(Chat)({
    id: chatId,
    title: 'Try the blazer on me',
    thread: `acct--${chatId}`,
    messages: [
      { id: 'm1', role: 'person', text: 'Try the blazer on me', parts: [], at: '2026-11-04T20:00:00.000Z' },
      { id: 'm2', role: 'styld', text: 'Drawing you in it now.', parts, at: '2026-11-04T20:00:09.000Z' },
    ],
  })
