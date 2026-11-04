import { cdn } from '../../Cdn.ts'
import type { Look } from '@styld/protocol'
import { Array } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { styled } from '../../Styled.ts'
import * as styles from './PageView.styles.ts'

/** The pieces a look shows on its tile: its first four, two by two. */
export const lookMosaic = <M>(look: Look, h: HtmlBuilder<M>): Html =>
  h.span(
    styled(h, styles.mosaic()),
    Array.map(Array.take(look.pieces, 4), (piece) => h.img([h.Src(cdn.piece(piece)), h.Alt(''), h.Loading('lazy')])),
  )
