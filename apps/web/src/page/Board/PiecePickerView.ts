import { format, type Locale } from '@styld/i18n'
import { GarmentGroup, groupOf, ImageItem, PieceItem, PicturePin, type Piece, typesIn } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { cdn } from '../../Cdn.ts'
import { chip, chosen } from '../../Controls.styles.ts'
import { checkIcon } from '../../Icon.ts'
import type { PiecesData } from '../../ServerData.ts'
import { styled } from '../../Styled.ts'
import { bottomSheet, sheetShown } from '../Sheet.ts'
import { groupName, pieceDescription, typeName } from '../WardrobeWords.ts'
import { Message } from './Message.ts'
import type { Model } from './Model.ts'
import * as styles from './PageView.styles.ts'
import * as pickerStyles from './PiecePickerView.styles.ts'
import { boardImage } from './Table.ts'

/** A chip that filters what a sheet offers, pressed while it applies; the new-board sheet's chips are these too. */
export const filterButton = <M>(label: string, pressed: boolean, message: M, h: HtmlBuilder<M>): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaPressed(String(pressed)),
      h.OnClick(message),
      ...styled(h, cx(chip(), chosen(), pickerStyles.filter())),
    ],
    [label],
  )

/** All the pieces, or one garment group's: a chip each, the chosen one pressed. The new-board sheet's are these too. */
export const groupFilters = <M>(
  groups: ReadonlyArray<GarmentGroup>,
  current: Option.Option<GarmentGroup>,
  toMessage: (group: Option.Option<GarmentGroup>) => M,
  locale: Locale,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Role('group'),
      h.AriaLabel(format(locale, 'wardrobe.filterCategories', {})),
      ...styled(h, pickerStyles.filters()),
    ],
    [
      filterButton(format(locale, 'wardrobe.allItems', {}), Option.isNone(current), toMessage(Option.none()), h),
      ...groups.map((group) =>
        filterButton(
          format(locale, groupName(group), {}),
          Option.contains(current, group),
          toMessage(Option.some(group)),
          h,
        ),
      ),
    ],
  )

const pieceButton = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const onTable = model.items.some((item) => Schema.is(PieceItem)(item) && item.pieceId === piece.id)
  const name = pieceDescription(piece, locale)
  return h.keyed('li')(
    piece.id,
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaLabel(format(locale, onTable ? 'board.selectPiece' : 'board.addPiece', { name })),
          h.AriaPressed(String(onTable)),
          h.OnClick(Message.ClickedWardrobePiece({ pieceId: piece.id })),
          ...styled(h, styles.pick()),
        ],
        [
          h.img([h.Src(cdn.piece(piece)), h.Alt(''), h.Loading('lazy'), ...styled(h, pickerStyles.image())]),
          onTable ? h.span(styled(h, styles.picked()), [checkIcon(h)]) : h.empty,
        ],
      ),
    ],
  )
}

const body = (model: Model, pieces: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const ready = pieces.filter((piece) => piece.status === 'ready')
  const inGroup = ready.filter((piece) =>
    Option.match(model.maybePickerGroup, {
      onNone: () => true,
      onSome: (group) => groupOf(piece.type) === group,
    }),
  )
  const shown = inGroup.filter((piece) =>
    Option.match(model.maybePickerType, {
      onNone: () => true,
      onSome: (type) => piece.type === type,
    }),
  )
  return h.div(styled(h, styles.head()), [
    groupFilters(
      GarmentGroup.literals,
      model.maybePickerGroup,
      (group) => Message.SelectedPickerGroup({ group }),
      locale,
      h,
    ),
    Option.match(model.maybePickerGroup, {
      onNone: () => h.empty,
      onSome: (group) =>
        h.div(
          [h.Role('group'), h.AriaLabel(format(locale, groupName(group), {})), ...styled(h, pickerStyles.filters())],
          [
            filterButton(
              format(locale, 'wardrobe.allItems', {}),
              Option.isNone(model.maybePickerType),
              Message.SelectedPickerType({ type: Option.none() }),
              h,
            ),
            ...typesIn(group)
              .filter((type) => inGroup.some((piece) => piece.type === type))
              .map((type) =>
                filterButton(
                  format(locale, typeName(type), {}),
                  Option.contains(model.maybePickerType, type),
                  Message.SelectedPickerType({ type: Option.some(type) }),
                  h,
                ),
              ),
          ],
        ),
    }),
    Array.match(shown, {
      onEmpty: () =>
        h.p(
          [h.Role('status'), ...styled(h, styles.meta())],
          [format(locale, ready.length === 0 ? 'board.wardrobeEmpty' : 'board.pickerEmpty', {})],
        ),
      onNonEmpty: (offered) =>
        h.ul(
          styled(h, styles.pickGrid()),
          offered.map((piece) => pieceButton(piece, model, locale, h)),
        ),
    }),
  ])
}

/** Pinned pictures can be put back without scrolling through the wardrobe. */
const pictures = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const placed = new Set(model.items.flatMap((item) => (Schema.is(ImageItem)(item) ? [item.imageId] : [])))
  const offTable = model.pins.filter(Schema.is(PicturePin)).filter((pin) => !placed.has(pin.imageId))
  return offTable.length === 0
    ? h.empty
    : h.ul(
        styled(h, styles.pickGrid()),
        offTable.map((pin) =>
          h.keyed('li')(
            pin.id,
            [],
            [
              h.button(
                [
                  h.Type('button'),
                  h.AriaLabel(format(locale, 'board.placePicture', {})),
                  ...styled(h, styles.pick()),
                  h.OnClick(Message.ClickedPinnedPicture({ imageId: pin.imageId })),
                ],
                [
                  h.img([
                    h.Src(boardImage(pin, 'thumb')),
                    h.Alt(''),
                    h.Loading('lazy'),
                    ...styled(h, pickerStyles.image()),
                  ]),
                ],
              ),
            ],
          ),
        ),
      )
}

export const piecePickerView = (model: Model, pieces: PiecesData, locale: Locale, h: HtmlBuilder<Message>): Html =>
  sheetShown(model.piecePicker)
    ? bottomSheet(
        {
          dialog: model.piecePicker,
          title: format(locale, 'board.addYourPiece', {}),
          locale,
          toParentMessage: (message) => Message.GotPiecePickerMessage({ message }),
          body: () => [
            h.div(styled(h, styles.sheetBody()), [
              AsyncData.matchData(pieces, {
                onEmpty: () => h.p([h.Role('status')], [format(locale, 'common.loading', {})]),
                onFailure: () => h.p([h.Role('alert')], [format(locale, 'board.wardrobeFailed', {})]),
                onData: (wardrobe) => body(model, wardrobe, locale, h),
              }),
              pictures(model, locale, h),
            ]),
          ],
        },
        h,
      )
    : h.empty
