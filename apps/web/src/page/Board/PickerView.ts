import { format, type Locale } from '@styld/i18n'
import { type Look, LookPin, type Piece, PiecePin } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../../ActionButton.ts'
import { primaryAction } from '../../Actions.styles.ts'
import { addIcon, checkIcon, loader } from '../../Icon.ts'
import { styled } from '../../Styled.ts'
import { Message } from './Message.ts'
import { type Model, PinWork } from './Model.ts'
import * as styles from './PageView.styles.ts'
import { pieceImage } from './Table.ts'

// The board's picker: the person's ready pieces and looks that are not pinned yet, ticked and pinned together.

export const pieceName = (piece: Piece, locale: Locale) => piece.name ?? format(locale, 'board.pieceFallback', {})

/** The pieces a look shows on its tile: its first four, two by two. */
export const lookMosaic = (look: Look, h: HtmlBuilder<Message>): Html =>
  h.span(
    styled(h, styles.mosaic()),
    Array.map(Array.take(look.pieces, 4), (piece) =>
      h.img([h.Src(pieceImage(piece.id)), h.Alt(''), h.Loading('lazy')]),
    ),
  )

const pickButton = (pick: string, label: string, content: Html, model: Model, h: HtmlBuilder<Message>): Html => {
  const isPicked = model.picks.includes(pick)
  return h.keyed('li')(
    pick,
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaPressed(isPicked ? 'true' : 'false'),
          h.AriaLabel(label),
          ...styled(h, styles.pick()),
          h.OnClick(Message.ToggledPick({ pick })),
        ],
        [content, isPicked ? h.span(styled(h, styles.picked()), [checkIcon(h)]) : h.empty],
      ),
    ],
  )
}

/** The picker sheet: the ready pieces and the looks not pinned yet, ticked and pinned together. */
export const pickerBody = (
  model: Model,
  wardrobe: ReadonlyArray<Piece>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const pinned = new Set(
    Array.flatMap(model.pins, (pin) => {
      if (Schema.is(PiecePin)(pin)) return [`piece:${pin.piece.id}`]
      return Schema.is(LookPin)(pin) ? [`look:${pin.look.id}`] : []
    }),
  )
  const pieces = Array.filter(wardrobe, (piece) => piece.status === 'ready' && !pinned.has(`piece:${piece.id}`))
  const looks = Array.filter(
    Option.getOrElse(AsyncData.getData(model.looks), () => []),
    (look) => !pinned.has(`look:${look.id}`),
  )
  const sending = PinWork.guards.Sending(model.pinWork)
  return [
    h.h3(styled(h, styles.sheetSection()), [format(locale, 'studio.addMenuPieces', {})]),
    Array.match(pieces, {
      onEmpty: () => h.p(styled(h, styles.meta()), [format(locale, 'board.pickerEmpty', {})]),
      onNonEmpty: (ready) =>
        h.ul(
          styled(h, styles.pickGrid()),
          Array.map(ready, (piece) =>
            pickButton(
              `piece:${piece.id}`,
              pieceName(piece, locale),
              h.img([h.Src(pieceImage(piece.id)), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.cutout())]),
              model,
              h,
            ),
          ),
        ),
    }),
    AsyncData.isFailure(model.looks)
      ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'board.looksFailed', {})])
      : looks.length === 0
        ? h.empty
        : h.div(styled(h, styles.head()), [
            h.h3(styled(h, styles.sheetSection()), [format(locale, 'studio.addMenuLooks', {})]),
            h.ul(
              styled(h, styles.pickGrid()),
              Array.map(looks, (look) => pickButton(`look:${look.id}`, look.name, lookMosaic(look, h), model, h)),
            ),
          ]),
    PinWork.guards.Failed(model.pinWork)
      ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'studio.addFailed', {})])
      : h.empty,
    actionButton(
      {
        label: sending
          ? format(locale, 'studio.pinning', {})
          : format(locale, 'board.pickSelected', { count: model.picks.length }),
        style: primaryAction(),
        isDisabled: sending || model.picks.length === 0,
        leading: sending ? loader(h) : addIcon(h),
        onClick: Message.SubmittedPicks(),
      },
      h,
    ),
  ]
}
