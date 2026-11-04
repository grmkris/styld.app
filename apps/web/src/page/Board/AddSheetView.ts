import { format, type Locale, type MessageKey } from '@styld/i18n'
import { ImageItem, PieceItem, PicturePin, type Look, type Photo, type Piece, type TryOn } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cdn } from '../../Cdn.ts'
import type { PiecesData } from '../../ServerData.ts'
import { styled } from '../../Styled.ts'
import { photosRouter, tryOnRouter } from '../../route.ts'
import { wearsMatching } from '../AskSearch.ts'
import { piecesPane, searchField, type PickerConfig } from '../PiecePickerView.ts'
import * as pickerStyles from '../PiecePickerView.styles.ts'
import { bottomSheet, sheetShown } from '../Sheet.ts'
import { Message } from './Message.ts'
import type { AddKind, Model } from './Model.ts'
import * as styles from './AddSheetView.styles.ts'
import * as boardStyles from './PageView.styles.ts'
import { lookMosaic } from './PickerView.ts'
import { boardImage } from './Table.ts'

// The board's Add sheet: what kind of thing it offers, one search box across all of them, and a grid of what matches.
// A tap lays the thing on the table; the sheet closes behind it.

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
          h.AriaPressed(String(model.addKind === kind)),
          h.OnClick(Message.SelectedAddKind({ kind })),
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
    (looks) => looks.filter((look) => wearsMatching(look.name, look.pieces, model.piecePicker.query, [locale])),
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
          model.piecePicker.query,
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
      tryOns.filter((tryOn) =>
        wearsMatching('', piecesOf(tryOn.pieceIds, wardrobe), model.piecePicker.query, [locale]),
      ),
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

/** Pictures pinned on the board but off its table, put back with a tap. */
const offTable = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const placed = new Set(model.items.flatMap((item) => (Schema.is(ImageItem)(item) ? [item.imageId] : [])))
  const pictures = model.pins.filter(Schema.is(PicturePin)).filter((pin) => !placed.has(pin.imageId))
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

const piecesConfig = (model: Model, pieces: PiecesData, locale: Locale): PickerConfig<Message> => ({
  picker: model.piecePicker,
  pieces,
  locale,
  title: format(locale, 'board.add.title', {}),
  emptyWardrobe: format(locale, 'board.wardrobeEmpty', {}),
  messages: {
    sheet: (message) => Message.GotPiecePickerMessage({ message }),
    group: (group) => Message.SelectedPickerGroup({ group }),
    type: (type) => Message.SelectedPickerType({ type }),
    query: (query) => Message.UpdatedPickerQuery({ query }),
    piece: ({ id }) => Message.ClickedWardrobePiece({ pieceId: id }),
  },
  isChosen: (piece) => model.items.some((item) => Schema.is(PieceItem)(item) && item.pieceId === piece.id),
  pieceLabel: (name, onTable) => format(locale, onTable ? 'board.selectPiece' : 'board.addPiece', { name }),
  after: [],
})

const kindPane = (model: Model, pieces: PiecesData, locale: Locale, h: HtmlBuilder<Message>) => {
  const wardrobe = Option.getOrElse(AsyncData.getData(pieces), () => [])
  switch (model.addKind) {
    case 'pieces':
      return [...piecesPane(piecesConfig(model, pieces, locale), h), offTable(model, locale, h)]
    case 'looks':
      return looksPane(model, wardrobe, locale, h)
    case 'gallery':
      return galleryPane(model, wardrobe, locale, h)
    case 'tryOns':
      return tryOnsPane(model, wardrobe, locale, h)
  }
}

/** "Add": the sheet of everything the person can lay on the table, while it is shown. */
export const addSheetView = (model: Model, pieces: PiecesData, locale: Locale, h: HtmlBuilder<Message>): Html =>
  sheetShown(model.piecePicker.sheet)
    ? bottomSheet(
        {
          dialog: model.piecePicker.sheet,
          title: format(locale, 'board.add.title', {}),
          locale,
          toParentMessage: (message) => Message.GotPiecePickerMessage({ message }),
          body: () => [
            h.div(styled(h, boardStyles.sheetBody()), [
              h.div(styled(h, boardStyles.head()), [
                kindsView(model, locale, h),
                searchField(
                  {
                    query: model.piecePicker.query,
                    label: format(locale, 'board.add.search', {}),
                    onInput: (query) => Message.UpdatedPickerQuery({ query }),
                  },
                  h,
                ),
                ...kindPane(model, pieces, locale, h),
              ]),
            ]),
          ],
        },
        h,
      )
    : h.empty
