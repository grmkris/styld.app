import { format, type Locale } from '@styld/i18n'
import { secondaryAction } from '../Actions.styles.ts'
import { wardrobeRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { retryView } from './Retry.ts'
import type { HtmlBuilder } from 'foldkit/html'
import { Message } from './Piece.ts'
import { details } from './PieceView.styles.ts'

export const missingPiece = (locale: Locale, h: HtmlBuilder<Message>) =>
  h.div(styled(h, details()), [
    h.p([h.Role('alert')], [format(locale, 'wardrobe.itemNotFound', {})]),
    h.a([h.Href(wardrobeRouter({})), ...styled(h, secondaryAction())], [format(locale, 'wardrobe.backToWardrobe', {})]),
  ])

export const failedPiece = (locale: Locale, h: HtmlBuilder<Message>) =>
  retryView(format(locale, 'wardrobe.shelves.loadFailed', {}), locale, Message.ClickedRetry(), h)
