import { Option } from 'effect'
import { Command, given, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import * as StylistTryOns from '../src/page/StylistTryOns.ts'
import { chatNaming, done, drawing } from './TryOnFixtures.ts'

// A try-on Styld started in a chat (owner, 4 November 2026): the reply carries only its id; the page reads it with the
// person's session, follows it while it is drawn, and shows its picture opening its own page.

/** A reply naming the same try-on twice: it is read once. */
const chat = chatNaming([
  { _tag: 'TryOn', tryOnId: drawing.id },
  { _tag: 'TryOn', tryOnId: drawing.id },
])

/** The read Commands a step asked for, by name and arguments. */
const reads = (commands: ReadonlyArray<{ readonly name: string; readonly args?: unknown }> | undefined) =>
  (commands ?? []).map(({ name, args }) => ({ name, args }))

const readOf = { name: 'ReadTryOn', args: { tryOnId: drawing.id } }

/** What the chat's try-ons poll waits on. */
const pending = (cards: StylistTryOns.Model) =>
  StylistTryOns.subscriptions.chatTryOnsWhileMaking.modelToDependencies(cards).pendingIds

describe('A try-on in a chat with Styld', () => {
  test('is read once when its chat is shown, followed while it is drawn, and left alone once drawn', () => {
    story(
      StylistTryOns.update,
      given(StylistTryOns.init()),
      model((cards) => expect(reads(StylistTryOns.follow(cards, chat).commands)).toEqual([readOf])),
    )
    story(
      StylistTryOns.update,
      given(
        StylistTryOns.update(StylistTryOns.init(), StylistTryOns.Message.SucceededReadTryOn({ tryOn: drawing })).model,
      ),
      model((cards) => expect(pending(cards)).toEqual([drawing.id])),
      model((cards) => expect(reads(StylistTryOns.follow(cards, chat).commands)).toEqual([])),
      Command.expectNone(),
    )
    const ticked = StylistTryOns.update(
      StylistTryOns.update(StylistTryOns.init(), StylistTryOns.Message.SucceededReadTryOn({ tryOn: drawing })).model,
      StylistTryOns.Message.TickedTryOnsRefresh(),
    )
    expect(reads(ticked.commands)).toEqual([readOf])
    const drawn = StylistTryOns.update(ticked.model, StylistTryOns.Message.SucceededReadTryOn({ tryOn: done })).model
    expect(pending(drawn)).toEqual([])
    expect(StylistTryOns.tryOnOf(drawn, done.id)).toEqual(Option.some(done))
  })
})
