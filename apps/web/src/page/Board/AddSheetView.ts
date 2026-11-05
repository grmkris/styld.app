import { format, type Locale, type MessageKey } from '@styld/i18n'
import {
  type BoardItem,
  ImageItem,
  PieceItem,
  type Pin,
  PicturePin,
  type Look,
  type Photo,
  type Piece,
  type TryOn,
} from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cdn } from '../../Cdn.ts'
import type { PiecesData } from '../../ServerData.ts'
import { styled } from '../../Styled.ts'
import { photosRouter, tryOnRouter } from '../../route.ts'
import { wearsMatching } from '../AskSearch.ts'
import { piecesPane, searchField, type PickerConfig } from '../PiecePickerView.ts'
import * as pickerStyles from '../PiecePickerView.styles.ts'
import { bottomSheet, sheetShown } from '../Sheet.ts'
import { actionButton } from '../../ActionButton.ts'
import { secondaryAction } from '../../Actions.styles.ts'
import { addIcon } from '../../Icon.ts'
import { type AddKind, Message, type Model } from './AddSheet.ts'
import * as styles from './AddSheetView.styles.ts'
import * as boardStyles from './PageView.styles.ts'
import { lookMosaic } from './PickerView.ts'
import { boardImage } from './Table.ts'

// The board's Add sheet: what kind of thing it offers, one search box across all of them, and a grid of what matches.
// A tap closes the sheet, and the board lays the thing on its table.

const kindNames: Record<AddKind, MessageKey> = {
  pieces: 'board.add.pieces',
  looks: 'board.add.looks',
  gallery: 'board.add.gallery',
  tryOns: 'board.add.tryOns',
}

const kindsView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Role('group'), h.AriaLabel(format(locale, 'board.add.kinds', {})), ...styled(h, styles.kinds())],
    (['pieces', 'looks', 'gallery', 'tryOns'] as const).map((kind) =>
      h.button(
        [
          h.Type('button'),
          h.AriaPressed(String(model.kind === kind)),
          h.OnClick(Message.SelectedKind({ kind })),
          ...styled(h, styles.kind()),
        ],
        [format(locale, kindNames[kind], {})],
      ),
    ),
  )

/** One thing to put on the table: its picture in a square, said in full, with a line under it when it has a name. */
const tile = (
  key: string,
  label: string,
  picture: Html,
  message: Message,
  under: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('li')(key, styled(h, pickerStyles.tile()), [
    h.button([h.Type('button'), h.AriaLabel(label), h.OnClick(message), ...styled(h, boardStyles.pick())], [picture]),
    ...under,
  ])

const caption = (text: string, h: HtmlBuilder<Message>): Html =>
  h.span([h.AriaHidden(true), ...styled(h, pickerStyles.caption())], [text])

const grid = (tiles: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.ul(styled(h, boardStyles.pickGrid()), [...tiles])

/** What the sheet says over an empty kind, or one that does not match the search. */
const note = (text: string, h: HtmlBuilder<Message>, more: ReadonlyArray<Html | string> = []): Html =>
  h.p([h.Role('status'), ...styled(h, boardStyles.meta())], [text, ...more])

/** A kind's things once they are read: loading, failed, none at all, none matching, or their tiles. */
const pane = <A>(
  data: AsyncData.AsyncData<ReadonlyArray<A>, unknown>,
  shown: (all: ReadonlyArray<A>) => ReadonlyArray<A>,
  copy: { readonly failed: string; readonly none: ReadonlyArray<Html> },
  toTile: (thing: A) => Html,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  AsyncData.matchData(data, {
    onEmpty: () => [note(format(locale, 'common.loading', {}), h)],
    onFailure: () => [h.p([h.Role('alert'), ...styled(h, boardStyles.problem())], [copy.failed])],
    onData: (all) =>
      all.length === 0
        ? copy.none
        : Array.match(shown(all), {
            onEmpty: () => [note(format(locale, 'board.add.noneFound', {}), h)],
            onNonEmpty: (things) => [grid(things.map(toTile), h)],
          }),
  })

/** The pieces a photo or a try-on wears, of those still in the wardrobe. */
const piecesOf = (ids: ReadonlyArray<string>, wardrobe: ReadonlyArray<Piece>) =>
  wardrobe.filter((piece) => ids.includes(piece.id))

const looksPane = (model: Model, wardrobe: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>) =>
  pane<Look>(
    model.looks,
    (looks) => looks.filter((look) => wearsMatching(look.name, look.pieces, model.picker.query, [locale])),
    {
      failed: format(locale, 'board.looksFailed', {}),
      none: [note(format(locale, 'board.add.noLooks', {}), h)],
    },
    (look) =>
      tile(
        look.id,
        format(locale, 'board.add.putLook', { name: look.name }),
        lookMosaic(look, h),
        Message.ClickedLook({ lookId: look.id }),
        [caption(look.name, h)],
        h,
      ),
    locale,
    h,
  )

const photoTile = (photo: Photo, locale: Locale, h: HtmlBuilder<Message>): Html =>
  tile(
    photo.id,
    format(locale, 'board.add.putPhoto', {}),
    h.img([h.Src(cdn.photo(photo, 'thumb')), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.photo())]),
    Message.ClickedGalleryPhoto({ photoId: photo.id, picture: 'photo' }),
    photo.hasCutout
      ? [
          h.button(
            [
              h.Type('button'),
              h.AriaLabel(format(locale, 'board.add.putCutout', {})),
              h.OnClick(Message.ClickedGalleryPhoto({ photoId: photo.id, picture: 'cutout' })),
              ...styled(h, styles.justMe()),
            ],
            [format(locale, 'board.add.justMe', {})],
          ),
        ]
      : [],
    h,
  )

const galleryPane = (model: Model, wardrobe: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>) =>
  pane<Photo>(
    AsyncData.map(model.photos, (photos) => photos.filter((photo) => photo.images !== undefined)),
    (photos) =>
      photos.filter((photo) =>
        wearsMatching(
          '',
          piecesOf(
            photo.garments.flatMap(({ pieceId }) => (pieceId === null ? [] : [pieceId])),
            wardrobe,
          ),
          model.picker.query,
          [locale],
        ),
      ),
    {
      failed: format(locale, 'board.add.galleryFailed', {}),
      none: [
        note(format(locale, 'board.add.noPhotos', {}), h, [
          ' ',
          h.a([h.Href(photosRouter({}))], [format(locale, 'board.add.openGallery', {})]),
        ]),
      ],
    },
    (photo) => photoTile(photo, locale, h),
    locale,
    h,
  )

const tryOnsPane = (model: Model, wardrobe: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>) =>
  pane<TryOn>(
    AsyncData.map(model.tryOns, (tryOns) =>
      tryOns.filter((tryOn) => tryOn.status === 'done' && tryOn.images !== undefined),
    ),
    (tryOns) =>
      tryOns.filter((tryOn) => wearsMatching('', piecesOf(tryOn.pieceIds, wardrobe), model.picker.query, [locale])),
    {
      failed: format(locale, 'board.add.tryOnsFailed', {}),
      none: [
        note(format(locale, 'board.add.noTryOns', {}), h, [
          ' ',
          h.a([h.Href(tryOnRouter({}))], [format(locale, 'board.add.openTryOn', {})]),
        ]),
      ],
    },
    (tryOn) =>
      tile(
        tryOn.id,
        format(locale, 'board.add.putTryOn', {}),
        h.img([h.Src(cdn.tryOn(tryOn, 'thumb')), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.photo())]),
        Message.ClickedTryOn({ tryOnId: tryOn.id }),
        [],
        h,
      ),
    locale,
    h,
  )

/** What the board tells its Add sheet: the wardrobe, and what is on its table and pinned. */
type Inputs = {
  readonly pieces: PiecesData
  readonly locale: Locale
  readonly items: ReadonlyArray<BoardItem>
  readonly pins: ReadonlyArray<Pin>
}

/** Pictures pinned on the board but off its table, put back with a tap. */
const offTable = ({ items, pins, locale }: Inputs, h: HtmlBuilder<Message>): Html => {
  const placed = new Set(items.flatMap((item) => (Schema.is(ImageItem)(item) ? [item.imageId] : [])))
  const pictures = pins.filter(Schema.is(PicturePin)).filter((pin) => !placed.has(pin.imageId))
  return pictures.length === 0
    ? h.empty
    : h.div(styled(h, boardStyles.head()), [
        h.h3(styled(h, boardStyles.sheetSection()), [format(locale, 'board.add.offTable', {})]),
        grid(
          pictures.map((pin) =>
            tile(
              pin.id,
              format(locale, 'board.placePicture', {}),
              h.img([
                h.Src(boardImage(pin, 'thumb')),
                h.Alt(''),
                h.Loading('lazy'),
                ...styled(h, pickerStyles.image()),
              ]),
              Message.ClickedPinnedPicture({ imageId: pin.imageId }),
              [],
              h,
            ),
          ),
          h,
        ),
      ])
}

/** The wardrobe's pieces; one already on the table is selected there rather than added again. */
const piecesView = (model: Model, { pieces, items, locale }: Inputs, h: HtmlBuilder<Message>) => {
  const config: PickerConfig<Message> = {
    picker: model.picker,
    pieces,
    locale,
    title: format(locale, 'board.add.title', {}),
    emptyWardrobe: format(locale, 'board.wardrobeEmpty', {}),
    messages: {
      sheet: (message) => Message.GotSheetMessage({ message }),
      group: (group) => Message.SelectedGroup({ group }),
      type: (type) => Message.SelectedType({ type }),
      query: (query) => Message.UpdatedQuery({ query }),
      piece: ({ id }) => Message.ClickedPiece({ pieceId: id }),
    },
    isChosen: (piece) => items.some((item) => Schema.is(PieceItem)(item) && item.pieceId === piece.id),
    pieceLabel: (name, onTable) => format(locale, onTable ? 'board.selectPiece' : 'board.addPiece', { name }),
    after: [],
  }
  return piecesPane(config, h)
}

const kindPane = (model: Model, inputs: Inputs, h: HtmlBuilder<Message>) => {
  const { pieces, locale } = inputs
  const wardrobe = Option.getOrElse(AsyncData.getData(pieces), () => [])
  switch (model.kind) {
    case 'pieces':
      return [...piecesView(model, inputs, h), offTable(inputs, h)]
    case 'looks':
      return looksPane(model, wardrobe, locale, h)
    case 'gallery':
      return galleryPane(model, wardrobe, locale, h)
    case 'tryOns':
      return tryOnsPane(model, wardrobe, locale, h)
  }
}

/** "Add", in the tray under the table: it opens the sheet. */
export const buttonView = Submodel.defineView<Model, Message, { readonly locale: Locale }>((_model, { locale }, h) =>
  actionButton(
    {
      label: format(locale, 'board.add.button', {}),
      leading: addIcon(h),
      style: secondaryAction(),
      onClick: Message.ClickedAdd(),
    },
    h,
  ),
)

/** The sheet of everything the person can lay on the table, while it is shown. */
export const sheetView = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  sheetShown(model.picker.sheet)
    ? bottomSheet(
        {
          dialog: model.picker.sheet,
          title: format(inputs.locale, 'board.add.title', {}),
          locale: inputs.locale,
          toParentMessage: (message) => Message.GotSheetMessage({ message }),
          body: () => [
            h.div(styled(h, boardStyles.sheetBody()), [
              h.div(styled(h, boardStyles.head()), [
                kindsView(model, inputs.locale, h),
                searchField(
                  {
                    query: model.picker.query,
                    label: format(inputs.locale, 'board.add.search', {}),
                    onInput: (query) => Message.UpdatedQuery({ query }),
                  },
                  h,
                ),
                ...kindPane(model, inputs, h),
              ]),
            ]),
          ],
        },
        h,
      )
    : h.empty,
)
