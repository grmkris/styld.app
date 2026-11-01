import {
  AssistantView,
  BoardView,
  PieceItem,
  ViewImages,
  type ViewLabels,
  type ViewPiece,
  type ViewPin,
  WardrobeView,
  Language,
} from '@styld/protocol'
import { Effect, Match, Option, Record, Schema } from 'effect'
import { Command, Port, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { type ImageSource, stillTable } from '../page/Board/Table.ts'
import { styled } from '../Styled.ts'
import {
  caption,
  empty,
  grid,
  heading,
  open,
  picture,
  pictureFrame,
  subheading,
  table,
  tile,
  viewRoot,
} from './Views.styles.ts'

/** What the host bridge hands the view: a tool result to show, or the host's language. */
const HostInput = Schema.Union([
  Schema.TaggedStruct('ShowedResult', { view: AssistantView, images: ViewImages }),
  Schema.TaggedStruct('ChangedLanguage', { language: Language }),
])
type HostInput = typeof HostInput.Type

/** What the view asks of the host. */
const HostRequest = Schema.Union([Schema.TaggedStruct('OpenLink', { url: Schema.String })])

export const ports = {
  inbound: { host: Port.inbound(HostInput) },
  outbound: { request: Port.outbound(HostRequest) },
}

// MODEL

/** @internal Exported for its tests. */
export const Showing = defineTaggedUnion({
  Waiting: {},
  Wardrobe: { view: WardrobeView },
  Board: { view: BoardView },
})

const Model = Schema.Struct({
  showing: Showing,
  images: ViewImages,
  language: Language,
})
type Model = typeof Model.Type

/** @internal Exported for its tests. */
export const init = (): Update.Return<Model, Message> => ({
  model: { showing: Showing.Waiting(), images: {}, language: 'en' },
})

// MESSAGE

/** @internal Exported for its tests. */
export const Message = defineMessageUnion({
  ReceivedHost: { input: HostInput },
  ClickedOpen: { url: Schema.String },
  CompletedOpen: {},
})
type Message = typeof Message.Type

// COMMAND

/** @internal Exported for its tests. */
export const OpenLink = Command.define('OpenLink', {
  args: { url: Schema.String },
  messages: [Message.CompletedOpen],
  execute: ({ url }) =>
    Port.emit(ports.outbound.request, { _tag: 'OpenLink', url }).pipe(Effect.as(Message.CompletedOpen())),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const receive = (model: Model, input: HostInput): UpdateReturn =>
  Match.value(input).pipe(
    Match.tagsExhaustive({
      ShowedResult: ({ view, images }) => ({
        model: modifyFields(model, {
          showing: () =>
            Match.value(view).pipe(
              Match.tagsExhaustive({
                WardrobeView: (shown) => Showing.Wardrobe({ view: shown }),
                BoardView: (shown) => Showing.Board({ view: shown }),
              }),
            ),
          images: (known) => Record.union(known, images, (_known, incoming) => incoming),
        }),
      }),
      ChangedLanguage: ({ language }) => ({ model: modifyFields(model, { language: () => language }) }),
    }),
  )

/** @internal Exported for its tests. */
export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ReceivedHost: ({ input }) => receive(model, input),
    ClickedOpen: ({ url }) => ({ model, commands: [OpenLink({ url })] }),
    CompletedOpen: () => ({ model }),
  })

// SUBSCRIPTION

const subscriptions = Subscription.make<Model, Message>()(() => ({
  host: Port.subscriptionEntry(ports.inbound.host, (input) => Message.ReceivedHost({ input })),
}))

// VIEW

/** A tile's picture, when the result carried one, and its caption. */
const tileContent = (image: Option.Option<string>, text: string, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.div(
    styled(h, pictureFrame()),
    Option.match(image, {
      onNone: () => [],
      onSome: (source) => [h.img([h.Src(source), h.Alt(''), ...styled(h, picture())])],
    }),
  ),
  h.span(styled(h, caption()), [text]),
]

const pieceTile = (piece: ViewPiece, image: Option.Option<string>, labels: ViewLabels, h: HtmlBuilder<Message>) =>
  h.keyed('li')(
    piece.id,
    [],
    [
      h.button(
        [h.Type('button'), h.OnClick(Message.ClickedOpen({ url: piece.url })), ...styled(h, tile())],
        tileContent(image, piece.name ?? labels.groups[piece.group], h),
      ),
    ],
  )

const wardrobe = (view: WardrobeView, model: Model, h: HtmlBuilder<Message>): Html => {
  const labels = view.labels[model.language]
  return h.section(styled(h, viewRoot()), [
    h.h1(styled(h, heading()), [labels.wardrobeTitle]),
    view.pieces.length === 0
      ? h.p(styled(h, empty()), [labels.empty])
      : h.ul(
          styled(h, grid()),
          view.pieces.map((piece) => pieceTile(piece, Record.get(model.images, piece.id), labels, h)),
        ),
    h.button(
      [h.Type('button'), h.OnClick(Message.ClickedOpen({ url: view.url })), ...styled(h, open())],
      [labels.openInStyld],
    ),
  ])
}

/** A pin's tile: its picture, its name, and its page when it has one. */
const pinTile = (pin: ViewPin, image: Option.Option<string>, fallback: string, h: HtmlBuilder<Message>) => {
  const content = tileContent(image, pin.name ?? fallback, h)
  return h.keyed('li')(
    pin.id,
    [],
    [
      pin.url === null
        ? h.div(styled(h, tile()), content)
        : h.button([h.Type('button'), h.OnClick(Message.ClickedOpen({ url: pin.url })), ...styled(h, tile())], content),
    ],
  )
}

/** The board's pictures by their keys in the result's images. */
const fromImages =
  (images: ViewImages): ImageSource =>
  (item) =>
    Option.getOrUndefined(
      Record.get(images, Schema.is(PieceItem)(item) ? `piece:${item.pieceId}` : `picture:${item.imageId}`),
    )

const board = (shown: BoardView, model: Model, h: HtmlBuilder<Message>): Html => {
  const labels = shown.labels[model.language]
  return h.section(styled(h, viewRoot()), [
    h.h1(styled(h, heading()), [shown.name]),
    shown.items.length === 0
      ? h.empty
      : h.div(styled(h, table()), [stillTable(shown.items, shown.paper, [], h, fromImages(model.images))]),
    shown.pins.length === 0
      ? h.p(styled(h, empty()), [labels.empty])
      : h.div(
          [],
          [
            h.h2(styled(h, subheading()), [labels.pinned]),
            h.ul(
              styled(h, grid()),
              shown.pins.map((pin) => pinTile(pin, Record.get(model.images, pin.image), labels.picture, h)),
            ),
          ],
        ),
    h.button(
      [h.Type('button'), h.OnClick(Message.ClickedOpen({ url: shown.url })), ...styled(h, open())],
      [labels.openInStyld],
    ),
  ])
}

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  Showing.match(model.showing, {
    Waiting: () => h.div(styled(h, viewRoot())),
    Wardrobe: ({ view: shown }) => wardrobe(shown, model, h),
    Board: ({ view: shown }) => board(shown, model, h),
  })

// PROGRAM

export const makeViews = (container: HTMLElement) =>
  Runtime.makeElement({ Model, init, update, view, subscriptions, ports, container })
