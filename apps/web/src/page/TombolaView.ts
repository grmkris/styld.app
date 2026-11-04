import { cdn, piecesById } from '../Cdn.ts'
import { format, type Locale } from '@styld/i18n'
import type { Piece, PieceId, Season } from '@styld/protocol'
import { Array, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction, secondaryAction } from '../Actions.styles.ts'
import { closeIcon, diceIcon, loader } from '../Icon.ts'
import { pieceRouter } from '../route.ts'
import type { PiecesData } from '../ServerData.ts'
import { block } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import {
  Building,
  dialogId,
  HoldTombola,
  landedPiece,
  Message,
  type Model,
  openerId,
  resultId,
  Stage,
  tombolaPool,
  TurnWheel,
  wheelId,
} from './Tombola.ts'
import * as styles from './TombolaView.styles.ts'
import { Making } from './BoardStart.ts'
import { makingProblem } from './BoardStartView.ts'
import { round as roundButton } from './PageBar.styles.ts'
import { pieceLabel } from './WardrobeWords.ts'

// What to wear today: the button under the day, and the screen it opens, where a wheel of the person's pieces turns
// and stops on one. The wheel is only ever drawn in the browser (after a tap), so its angles go in as properties set
// through the CSSOM, which the edge CSP allows.

export type Inputs = {
  readonly pieces: PiecesData
  readonly maybeSeason: Option.Option<Season>
  readonly locale: Locale
}

/** The button: its shape while the pieces come, nothing while fewer than two can be drawn. */
const buttonView = (pieces: PiecesData, maybeSeason: Option.Option<Season>, locale: Locale, h: HtmlBuilder<Message>) =>
  AsyncData.matchData(pieces, {
    onEmpty: () =>
      h.span([h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, cx(block(), styles.buttonSkeleton()))]),
    onFailure: () => h.empty,
    onData: (list) => {
      const pool = tombolaPool(list, maybeSeason)
      return pool.length < 2
        ? h.empty
        : h.button(
            [
              h.Type('button'),
              h.Id(openerId),
              h.AriaHasPopup('dialog'),
              h.OnClick(Message.ClickedOpen({ pool, maybeSeason })),
              ...styled(h, cx(secondaryAction(), styles.button())),
            ],
            [diceIcon(h), format(locale, 'today.whatToWear', {})],
          )
    },
  })

/** The wheel, turning from where it stands to the drawn piece at the top, a few times round first. */
const wheelView = (
  round: number,
  slots: ReadonlyArray<PieceId>,
  landing: number,
  pieces: ReadonlyArray<Piece>,
  h: HtmlBuilder<Message>,
): Html => {
  const images = piecesById(pieces)
  return h.div(styled(h, styles.wheelBox()), [
    h.keyed('div')(
      `wheel-${round}`,
      [
        h.Id(wheelId),
        h.AriaHidden(true),
        h.Style({ '--land': `${String(-30 * landing - 1080)}deg` }),
        h.OnMount(TurnWheel({ round })),
        ...styled(h, styles.wheel()),
      ],
      slots.map((pieceId, index) =>
        h.span(
          [h.Style({ '--slot': String(index) }), ...styled(h, styles.slot())],
          [h.img([h.Src(cdn.pieceById(images, pieceId)), h.Alt(''), ...styled(h, styles.slotPicture())])],
        ),
      ),
    ),
  ])
}

/** The piece drawn: its picture large, what it is, and the ways on. */
/** A text button of the result: its label, or its loader and what it is doing while that is on its way. */
const resultButton = (
  label: string,
  sending: Option.Option<string>,
  onClick: Message,
  isDisabled: boolean,
  style: 'primary' | 'secondary',
  h: HtmlBuilder<Message>,
): Html =>
  actionButton(
    {
      label: Option.getOrElse(sending, () => label),
      leading: Option.isSome(sending) ? loader(h) : h.empty,
      style: style === 'primary' ? primaryAction() : secondaryAction(),
      onClick,
      isDisabled,
    },
    h,
  )

/** The piece drawn: its picture large, what it is, and the ways on. Make outfits with it carries the ink; one board
 * is on its way at a time. */
const resultView = (model: Model, piece: Piece, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const name = pieceLabel(piece, locale)
  const making = Making.guards.Sending(model.making)
  const building = Building.guards.Sending(model.building)
  return h.div(styled(h, styles.result()), [
    h.img([h.Src(cdn.piece(piece, 'full')), h.Alt(''), ...styled(h, styles.resultPicture())]),
    h.h3(
      [h.Id(resultId), ...styled(h, styles.resultTitle())],
      [format(locale, 'today.tombola.drawn', { piece: name })],
    ),
    h.div(styled(h, styles.actions()), [
      resultButton(
        format(locale, 'today.tombola.makeOutfits', {}),
        making ? Option.some(format(locale, 'boards.making', {})) : Option.none(),
        Message.ClickedMakeOutfits({ name: format(locale, 'boards.outfitsBoardName', { piece: name }) }),
        making || building,
        'primary',
        h,
      ),
      makingProblem(model.making, locale, h),
      h.div(styled(h, styles.pair()), [
        resultButton(
          format(locale, 'today.tombola.wearIt', {}),
          Option.none(),
          Message.ClickedWearIt(),
          making || building,
          'secondary',
          h,
        ),
        resultButton(
          format(locale, 'today.tombola.buildOwn', {}),
          building ? Option.some(format(locale, 'today.tombola.sending', {})) : Option.none(),
          Message.ClickedBuildOwn({ name: format(locale, 'today.tombola.ownBoardName', { piece: name }) }),
          making || building,
          'secondary',
          h,
        ),
      ]),
      Building.guards.Failed(model.building)
        ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'today.tombola.buildFailed', {})])
        : h.empty,
      h.div(styled(h, styles.links()), [
        h.a(
          [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, linkAction())],
          [format(locale, 'today.tombola.openPiece', {})],
        ),
        actionButton(
          {
            label: format(locale, 'today.tombola.again', {}),
            style: linkAction(),
            onClick: Message.ClickedSpinAgain(),
          },
          h,
        ),
      ]),
    ]),
  ])
}

const spinning = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p([h.Role('status'), ...styled(h, styles.status())], [format(locale, 'today.tombola.spinning', {})])

const stageView = (model: Model, pieces: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Stage.match(model.stage, {
    Closed: () => h.empty,
    Drawing: () => h.div(styled(h, styles.stage()), [spinning(locale, h)]),
    Turning: ({ round, slots, landing }) =>
      h.div(styled(h, styles.stage()), [wheelView(round, slots, landing, pieces, h), spinning(locale, h)]),
    Landed: () =>
      Option.match(
        Option.flatMap(landedPiece(model.stage), (pieceId) => Array.findFirst(pieces, (piece) => piece.id === pieceId)),
        {
          onNone: () => h.div(styled(h, styles.stage()), [spinning(locale, h)]),
          onSome: (piece) => h.div(styled(h, styles.stage()), [resultView(model, piece, locale, h)]),
        },
      ),
  })

/** The screen over the whole page while a spin is on: its title and Close, then the wheel or the piece. */
const screenView = (model: Model, pieces: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Stage.guards.Closed(model.stage)
    ? h.empty
    : h.dialog(
        [
          h.Id(dialogId),
          h.AriaLabelledBy('tombola-title'),
          h.OnMount(HoldTombola()),
          h.OnCancelPreventDefault(Message.ClickedClose()),
          ...styled(h, styles.screen()),
        ],
        [
          h.div(styled(h, styles.bar()), [
            h.h2([h.Id('tombola-title'), ...styled(h, styles.title())], [format(locale, 'today.whatToWear', {})]),
            h.button(
              [
                h.Type('button'),
                h.DataAttribute('tombola-close', ''),
                h.AriaLabel(format(locale, 'common.close', {})),
                h.OnClick(Message.ClickedClose()),
                ...styled(h, roundButton()),
              ],
              [closeIcon(h)],
            ),
          ]),
          stageView(model, pieces, locale, h),
        ],
      )

export const view = Submodel.defineView<Model, Message, Inputs>((model, { pieces, maybeSeason, locale }, h) =>
  h.div(styled(h, styles.slotBox()), [
    buttonView(pieces, maybeSeason, locale, h),
    screenView(
      model,
      Option.getOrElse(AsyncData.getData(pieces), (): ReadonlyArray<Piece> => []),
      locale,
      h,
    ),
  ]),
)
