import { Button } from '@foldkit/ui'
import { format, type Locale, type MessageKey } from '@styld/i18n'
import { GarmentGroup, groupOf, type Piece, Season, type Slot } from '@styld/protocol'
import { Array, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { cdn } from '../Cdn.ts'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction } from '../Actions.styles.ts'
import { addIcon, backIcon, boardsTabIcon, checkIcon, loader } from '../Icon.ts'
import type { PiecesData } from '../ServerData.ts'
import { styled } from '../Styled.ts'
import { Making, Message, type Model, Step } from './BoardStart.ts'
import { bottomSheet, sheetShown } from './Sheet.ts'
import { pieceDescription, pieceLabel } from './WardrobeWords.ts'
import * as askStyles from './AskView.styles.ts'
import * as boardStyles from './Board/PageView.styles.ts'
import { filterButton, groupFilters } from './PiecePickerView.ts'
import * as pickerStyles from './PiecePickerView.styles.ts'
import * as styles from './BoardStartView.styles.ts'

export interface Inputs {
  readonly locale: Locale
  readonly pieces: PiecesData
}

const seasonKey = (season: Season) => `wardrobe.season.${season}` as const satisfies MessageKey

/** What to add for each place the wardrobe lacks. */
const addKeys: Partial<Record<Slot, MessageKey>> = {
  top: 'boards.addTop',
  bottom: 'today.addBottom',
  shoes: 'today.addShoes',
}

const template = (title: string, hint: string, icon: Html, message: Message, h: HtmlBuilder<Message>): Html =>
  Button.view(
    {
      onClick: message,
      toView: (attributes) =>
        h.button(
          [...attributes.button, ...styled(h, askStyles.option())],
          [
            h.span(styled(h, askStyles.optionIcon()), [icon]),
            h.span([], [title]),
            h.span(styled(h, askStyles.optionHint()), [hint]),
          ],
        ),
    },
    h,
  )

const templatesView = (locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  template(
    format(locale, 'boards.templateBlank', {}),
    format(locale, 'boards.templateBlankHint', {}),
    addIcon(h),
    Message.ClickedBlank({ defaultName: format(locale, 'boards.defaultName', {}) }),
    h,
  ),
  template(
    format(locale, 'boards.templateOutfits', {}),
    format(locale, 'boards.templateOutfitsHint', {}),
    boardsTabIcon(h),
    Message.ClickedOutfitsTemplate(),
    h,
  ),
]

const anchorButton = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const isChosen = Option.contains(model.maybeAnchor, piece.id)
  return h.keyed('li')(
    piece.id,
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaLabel(pieceDescription(piece, locale)),
          h.AriaPressed(String(isChosen)),
          h.OnClick(Message.SelectedAnchor({ pieceId: piece.id })),
          ...styled(h, boardStyles.pick()),
        ],
        [
          h.img([h.Src(cdn.piece(piece)), h.Alt(''), h.Loading('lazy'), ...styled(h, pickerStyles.image())]),
          isChosen ? h.span(styled(h, boardStyles.picked()), [checkIcon(h)]) : h.empty,
        ],
      ),
    ],
  )
}

const problemView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Making.guards.Failed(model.making)
    ? h.div(
        [h.Role('alert'), ...styled(h, askStyles.optionProblem())],
        [
          format(locale, `boards.outfits_${model.making.problem}`, {}),
          ...model.making.missing.flatMap((slot) =>
            Option.toArray(Option.map(Option.fromNullishOr(addKeys[slot]), (key) => ` ${format(locale, key, {})}.`)),
          ),
        ],
      )
    : h.empty

/** The garment groups the person has pieces in, to narrow the pieces offered. */
const groupsView = (model: Model, ready: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>): Html =>
  groupFilters(
    GarmentGroup.literals.filter((group) => ready.some((piece) => groupOf(piece.type) === group)),
    model.maybeGroup,
    (group) => Message.SelectedGroup({ group }),
    locale,
    h,
  )

/** Any season, or one: the outfits keep to it. */
const seasonsView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Role('group'), h.AriaLabel(format(locale, 'boards.season', {})), ...styled(h, pickerStyles.filters())],
    [
      filterButton(
        format(locale, 'boards.seasonAny', {}),
        Option.isNone(model.maybeSeason),
        Message.SelectedSeason({ season: Option.none() }),
        h,
      ),
      ...Season.literals.map((season) =>
        filterButton(
          format(locale, seasonKey(season), {}),
          Option.contains(model.maybeSeason, season),
          Message.SelectedSeason({ season: Option.some(season) }),
          h,
        ),
      ),
    ],
  )

/** Make six outfits, named after the chosen piece, while one is chosen and nothing is being made. */
const makeButton = (model: Model, anchor: Option.Option<Piece>, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const sending = Making.guards.Sending(model.making)
  return actionButton(
    {
      label: format(locale, sending ? 'boards.making' : 'boards.makeOutfits', {}),
      leading: sending ? loader(h) : addIcon(h),
      style: primaryAction(),
      onClick: Message.SubmittedOutfits({
        name: Option.match(anchor, {
          onNone: () => format(locale, 'boards.defaultName', {}),
          onSome: (piece) => format(locale, 'boards.outfitsBoardName', { piece: pieceLabel(piece, locale) }),
        }),
      }),
      isDisabled: sending || Option.isNone(anchor),
    },
    h,
  )
}

const anchorView = (
  model: Model,
  pieces: ReadonlyArray<Piece>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const ready = pieces.filter((piece) => piece.status === 'ready')
  const shown = ready.filter((piece) =>
    Option.match(model.maybeGroup, { onNone: () => true, onSome: (group) => groupOf(piece.type) === group }),
  )
  const anchor = Option.flatMap(model.maybeAnchor, (id) => Array.findFirst(ready, (piece) => piece.id === id))
  return [
    h.button(
      [h.Type('button'), h.OnClick(Message.ClickedTemplates()), ...styled(h, cx(linkAction(), styles.back()))],
      [backIcon(h), format(locale, 'boards.templates', {})],
    ),
    h.p(styled(h, boardStyles.meta()), [format(locale, 'boards.pickAnchor', {})]),
    groupsView(model, ready, locale, h),
    Array.match(shown, {
      onEmpty: () =>
        h.p([h.Role('status'), ...styled(h, boardStyles.meta())], [format(locale, 'board.wardrobeEmpty', {})]),
      onNonEmpty: (offered) =>
        h.ul(
          styled(h, boardStyles.pickGrid()),
          offered.map((piece) => anchorButton(piece, model, locale, h)),
        ),
    }),
    seasonsView(model, locale, h),
    makeButton(model, anchor, locale, h),
    problemView(model, locale, h),
  ]
}

/** The new-board sheet: Blank or "One piece, six outfits", then the piece, the season and Make six outfits. Drawn only
 * while open. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, { locale, pieces }, h) =>
  sheetShown(model.sheet)
    ? bottomSheet(
        {
          dialog: model.sheet,
          title: format(
            locale,
            Step.guards.Templates(model.step) ? 'boards.chooserTitle' : 'boards.templateOutfits',
            {},
          ),
          body: () => [
            h.div(
              styled(h, boardStyles.sheetBody()),
              Step.guards.Templates(model.step)
                ? templatesView(locale, h)
                : anchorView(
                    model,
                    Option.getOrElse(AsyncData.getData(pieces), () => []),
                    locale,
                    h,
                  ),
            ),
          ],
          toParentMessage: (message) => Message.GotSheetMessage({ message }),
          locale,
        },
        h,
      )
    : h.empty,
)
