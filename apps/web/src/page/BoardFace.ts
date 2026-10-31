import { format, type Locale } from '@styld/i18n'
import type { BoardItem, Paper } from '@styld/protocol'
import { Array } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { styled } from '../Styled.ts'
import { type ImageSource, stillTable } from './Board/Table.ts'
import * as tableStyles from './Board/View.styles.ts'
import { cx } from 'zyzz'
import * as styles from './BoardFace.styles.ts'

/** One of a board's newest pins as its face shows it: where its picture comes from, or nothing to show. */
export type CoverPicture = { readonly id: string; readonly source: string }

/** A pin lying on the board's paper, as a cutout does: no frame, its photo's pale ground given to the paper. */
const coverTile = <Message>({ id, source }: CoverPicture, h: HtmlBuilder<Message>): Html =>
  h.keyed('span')(id, styled(h, styles.coverTile()), [
    source === '' ? h.empty : h.img([h.Src(source), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.coverImage())]),
  ])

/** A board as a list shows it, inside a link that names it: its collage; with no collage yet, its newest pins two by
 * two; with no pins either, its paper saying so. Its pictures and words are not read aloud: the link's name and pin
 * count say what it holds. Pictures come from Styld's own routes unless `source` says otherwise. */
export const boardFace = <Message>(
  face: {
    readonly items: ReadonlyArray<BoardItem>
    readonly paper: Paper
    readonly cover: ReadonlyArray<CoverPicture>
    readonly source?: ImageSource
  },
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  if (Array.isReadonlyArrayNonEmpty(face.items)) {
    return stillTable(face.items, face.paper, [], h, face.source)
  }
  return Array.match(face.cover, {
    // The board's own paper with its newest pins laid on it (Gallery's `.board .flat`), so it reads as a board.
    onNonEmpty: (pictures) =>
      h.span(
        [
          h.DataAttribute('paper', face.paper),
          ...styled(h, cx(tableStyles.paper(), tableStyles.still(), styles.cover())),
        ],
        pictures.map((picture) => coverTile(picture, h)),
      ),
    onEmpty: () =>
      h.span(styled(h, styles.blank()), [
        stillTable([], face.paper, [], h, face.source),
        h.span([h.AriaHidden(true), ...styled(h, styles.blankWords())], [format(locale, 'studio.emptyGridTitle', {})]),
      ]),
  })
}
