import { Chat, ChatSummary, LookId } from '@styld/protocol'
import { AsyncData } from 'foldkit'
import { Option, Schema } from 'effect'
import { expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { lenses } from '../src/Page.ts'
import { at, withPage } from './AppFixtures.ts'
import * as Stylist from '../src/page/Stylist.ts'
import { view } from '../src/View.ts'

const chatId = `ch_${'tee'.padEnd(22, 'x')}`
const pieceId = `pc_${'tee'.padEnd(22, 'x')}`
const lookId = LookId.make(`lk_${'tee'.padEnd(22, 'x')}`)

const stylistWith = (stylist: Stylist.Model) =>
  withPage(at('/ask/stylist', { signedIn: true }), lenses.stylist, () => stylist)

const chat = (replying?: 'writing' | 'failed') =>
  Schema.decodeUnknownSync(Chat)({
    id: chatId,
    title: 'What should I wear today?',
    thread: `acct--${chatId}`,
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
  test('a new chat lists the earlier chats with the day each last moved', () => {
    const earlier = Schema.decodeUnknownSync(ChatSummary)({
      id: chatId,
      title: 'What should I wear today?',
      updatedAt: '2026-10-29T18:00:00.000Z',
    })
    scene(
      { update, view },
      given(stylistWith(opened({ chats: AsyncData.Success({ data: [earlier] }) }))),
      expect(role('heading', { name: 'Earlier chats' })).toExist(),
      expect(role('button', { name: /^What should I wear today\?/ })).toExist(),
      expect(text('29 Oct')).toExist(),
    )
    // A chat from today says when today, so two that began alike can be told apart.
    const today = modifyFields(stylistWith(opened({ chats: AsyncData.Success({ data: [earlier] }) })), {
      context: (context) => ({ ...context, referenceTime: Date.parse('2026-10-29T20:00:00.000Z') }),
    })
    scene({ update, view }, given(today), expect(text('Today, 18:00')).toExist())
  })

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
      expect(role('button', { name: 'Analyze my wardrobe' })).toExist(),
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

  test('an analysis shows the exact counts as a card: groups, colours, what was worn, too much and too little', () => {
    const analysed = Schema.decodeUnknownSync(Chat)({
      id: chatId,
      title: 'Analyze my wardrobe',
      thread: `acct--${chatId}`,
      messages: [
        { id: 'm1', role: 'person', text: 'Analyze my wardrobe', parts: [], at: '2026-11-03T09:00:00.000Z' },
        {
          id: 'm2',
          role: 'styld',
          text: 'Mostly tops: a pair of trousers would make more of them.',
          parts: [
            {
              _tag: 'Analysis',
              analysis: {
                pieces: 14,
                groups: [
                  { group: 'clothing', count: 12 },
                  { group: 'shoes', count: 2 },
                ],
                types: [{ type: 'tops', count: 9 }],
                colours: [{ colour: 'white', count: 6 }],
                worn: { days: 60, pieces: 5, never: 9, most: [{ pieceId, days: 4 }] },
                surpluses: ['tops'],
                gaps: ['bottoms', 'layers'],
              },
            },
          ],
          at: '2026-11-03T09:00:05.000Z',
        },
      ],
    })
    scene(
      { update, view },
      given(stylistWith(opened({ open: Option.some(analysed) }))),
      expect(role('region', { name: 'Your wardrobe in numbers' })).toExist(),
      expect(text('14 pieces')).toExist(),
      expect(text('Clothing 12')).toExist(),
      expect(text('White 6')).toExist(),
      expect(text('Worn in the last 60 days: 5 of 14 · 9 pieces not worn')).toExist(),
      expect(role('list', { name: 'Worn most' })).toExist(),
      expect(text('Plenty of tops')).toExist(),
      expect(text('Could use more trousers and skirts, jackets and coats')).toExist(),
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
