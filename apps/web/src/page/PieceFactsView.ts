import type { Piece } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { linkAction } from '../Actions.styles.ts'
import { styled } from '../Styled.ts'
import { colourList } from './PieceFields.ts'
import * as styles from './PieceView.styles.ts'
import { occasionName, patternName, seasonName } from './WardrobeWords.ts'

const fact = <Message>(term: string, value: Html | string, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.fact()), [
    h.dt(styled(h, styles.factTerm()), [term]),
    h.dd(styled(h, styles.factValue()), [value]),
  ])

/** What the piece is, row by row (Gallery `item.html` › facts): its colours, named, when and what for it is worn, its
 * pattern and brand, the shop it came from, and the person's notes. Its kind is not repeated: the head says it. */
export const factsView = <Message>(piece: Piece, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.dl(styled(h, styles.facts()), [
    piece.colours.length === 0
      ? h.empty
      : fact(
          format(locale, 'wardrobe.colourFact', { count: piece.colours.length }),
          colourList(piece.colours, locale, h),
          h,
        ),
    // When it is worn: its seasons and Rainproof; a piece with no season says nothing, as it is worn all year.
    piece.seasons.length === 0 && !piece.rainproof
      ? h.empty
      : fact(
          format(locale, 'wardrobe.filterSeason', {}),
          [
            ...piece.seasons.map((season) => format(locale, seasonName(season), {})),
            ...(piece.rainproof ? [format(locale, 'wardrobe.rainproof', {})] : []),
          ].join(', '),
          h,
        ),
    piece.occasions.length === 0
      ? h.empty
      : fact(
          format(locale, 'wardrobe.filterOccasion', {}),
          piece.occasions.map((occasion) => format(locale, occasionName(occasion), {})).join(', '),
          h,
        ),
    piece.pattern === null
      ? h.empty
      : fact(format(locale, 'wardrobe.patternFact', {}), format(locale, patternName(piece.pattern), {}), h),
    piece.brand === null ? h.empty : fact(format(locale, 'wardrobe.filterBrand', {}), piece.brand, h),
    piece.shopUrl === null
      ? h.empty
      : fact(
          format(locale, 'wardrobe.shopFact', {}),
          h.a(
            [h.Href(piece.shopUrl), h.Target('_blank'), h.Rel('noopener noreferrer'), ...styled(h, linkAction())],
            [format(locale, 'wardrobe.shopLink', {})],
          ),
          h,
        ),
    piece.notes === null ? h.empty : fact(format(locale, 'wardrobe.notesLabel', {}), piece.notes, h),
  ])
