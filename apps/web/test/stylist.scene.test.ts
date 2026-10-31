import { catalogVersion } from '@styld/i18n'
import { Chat, LookId } from '@styld/protocol'
import { AsyncData } from 'foldkit'
import { Option, Schema } from 'effect'
import { expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { Session, init, update } from '../src/App.ts'
import * as Stylist from '../src/page/Stylist.ts'
import { view } from '../src/View.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }
const chatId = `ch_${'tee'.padEnd(22, 'x')}`
const pieceId = `pc_${'tee'.padEnd(22, 'x')}`
const lookId = LookId.make(`lk_${'tee'.padEnd(22, 'x')}`)

const stylistWith = (stylist: Stylist.Model) =>
  modifyFields(
    init({
      locale: 'en',
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: 0,
      pathname: '/ask/stylist',
      origin: 'https://styld.test',
      telemetryConsent: 'denied',
    }).model,
    { session: () => Session.SignedIn({ claims }), stylist: () => stylist },
  )

const chat = (replying?: 'writing' | 'failed') =>
  Schema.decodeUnknownSync(Chat)({
    id: chatId,
    title: 'What should I wear today?',
    messages: [
      { id: 'm1', role: 'person', text: 'What should I wear today?', parts: [], at: '2026-10-31T09:00:00.000Z' },
      {
        id: 'm2',
        role: 'styld',
        text: 'Wear your **white tee** with the jeans.',
        parts: [
          { _tag: 'Pieces', pieceIds: [pieceId] },
          { _tag: 'Look', lookId, name: 'Saturday' },
        ],
        at: '2026-10-31T09:00:09.000Z',
      },
      { id: 'm3', role: 'person', text: 'And for tonight?', parts: [], at: '2026-10-31T09:01:00.000Z' },
    ],
    ...(replying === undefined ? {} : { replying: { state: replying, text: '', parts: [] } }),
  })

const opened = (stylist: Partial<Stylist.Model>) => ({
  ...Stylist.init(Option.none()),
  chats: AsyncData.Success({ data: [] }),
  ...stylist,
})

describe('Styld, the stylist in the app', () => {
  test('arriving, the page is drawn in the shape of a chat until it knows whether one opens', () => {
    scene(
      { update, view },
      given(stylistWith(Stylist.init(Option.none()))),
      expect(role('heading', { name: 'Ask Styld', level: 1 })).toExist(),
      expect(role('button', { name: 'What should I wear today?' })).not.toExist(),
      expect(role('textbox', { name: 'Message to Styld' })).toExist(),
    )
  })

  test('a new chat says what Styld is, offers what to ask, and says what a message costs', () => {
    scene(
      { update, view },
      given(stylistWith(opened({}))),
      expect(role('heading', { name: 'Ask Styld', level: 1 })).toExist(),
      expect(role('button', { name: 'What should I wear today?' })).toExist(),
      expect(role('textbox', { name: 'Message to Styld' })).toExist(),
      expect(role('button', { name: 'Send' })).toBeDisabled(),
      expect(text('Each message uses 1 credit of today’s free allowance.')).toExist(),
      expect(role('button', { name: 'New chat' })).not.toExist(),
    )
  })

  test('a reply reads as plain text, with the pieces it suggests and the look it saved one tap away', () => {
    scene(
      { update, view },
      given(stylistWith(opened({ open: Option.some(chat()), draft: 'Thanks' }))),
      expect(role('list', { name: 'What should I wear today?' })).toExist(),
      expect(text('Wear your white tee with the jeans.')).toExist(),
      expect(role('link', { name: 'Open the piece' })).toHaveAttr('href', `/wardrobe/${pieceId}`),
      expect(role('link', { name: 'Open the look Saturday' })).toHaveAttr('href', `/looks/${lookId}`),
      expect(role('button', { name: 'Send' })).not.toBeDisabled(),
      expect(role('button', { name: 'New chat' })).toExist(),
    )
  })

  test('while Styld writes, it says so and nothing more can be sent; a reply that did not come says the credit is back', () => {
    scene(
      { update, view },
      given(stylistWith(opened({ open: Option.some(chat('writing')), draft: 'Thanks' }))),
      expect(role('status')).toHaveText('Styld is writing…'),
      expect(role('button', { name: 'Send' })).toBeDisabled(),
      expect(role('button', { name: 'New chat' })).toBeDisabled(),
    )
    scene(
      { update, view },
      given(stylistWith(opened({ open: Option.some(chat('failed')) }))),
      expect(role('status')).toHaveText('No answer came this time, and your credit is back. Ask again.'),
    )
  })

  test('a message that did not go says why, in place of the price', () => {
    scene(
      { update, view },
      given(
        stylistWith(
          opened({
            draft: 'Hi',
            sending: Stylist.Sending.Failed({ problem: 'dailyLimit', operationId: Option.none() }),
          }),
        ),
      ),
      expect(role('alert')).toHaveText('Today’s free allowance is spent. Ask again tomorrow.'),
      expect(text('Each message uses 1 credit of today’s free allowance.')).not.toExist(),
    )
  })
})
