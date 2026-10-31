import { Schema } from 'effect'
import { AccountClaims } from '@styld/auth/config'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import { Url } from 'foldkit/url'
import { Locale } from './Locale.ts'
import * as Account from './page/Account.ts'
import * as AddPiecesMessage from './page/AddPieces/Message.ts'
import * as Ask from './page/Ask.ts'
import * as BoardMessage from './page/Board/Message.ts'
import * as Boards from './page/Boards.ts'
import * as Login from './page/Login.ts'
import * as Look from './page/Look.ts'
import * as ProfileEditor from './page/ProfileEditor.ts'
import * as Looks from './page/Looks.ts'
import * as Piece from './page/Piece.ts'
import * as Review from './page/Review.ts'
import * as Stylist from './page/Stylist.ts'
import * as Today from './page/Today.ts'
import * as Visit from './page/Visit.ts'
import * as Wishlist from './page/Wishlist.ts'
import * as Wardrobe from './page/Wardrobe.ts'

/** Everything that can happen in the website: its own Messages and each page's, wrapped. Its own module so the
 * navigation can build them without importing the app. */
export const Message = defineMessageUnion({
  SelectedLocale: { value: Schema.String },
  SucceededSaveLocale: { locale: Locale },
  FailedSaveLocale: {},
  ReceivedSession: { claims: Schema.NullOr(AccountClaims) },
  FailedReadSession: {},
  RequestedSession: {},
  SucceededSignOut: {},
  FailedSignOut: {},
  CompletedNavigate: {},
  /** A link was followed: between tab pages it stays in the page, everywhere else it loads whole. */
  ClickedLink: { request: UrlRequest },
  /** The address changed in the page: a tab page was opened, or Back or Forward went to one. */
  ChangedUrl: { url: Url },
  CompletedNavigateInternal: {},
  CompletedScrollToTop: {},
  CompletedScrollToAnchor: {},
  CompletedFocusPageTitle: {},
  GotLoginMessage: { message: Login.Message },
  GotAccountMessage: { message: Account.Message },
  GotWardrobeMessage: { message: Wardrobe.Message },
  GotPieceMessage: { message: Piece.Message },
  GotAddPiecesMessage: { message: AddPiecesMessage.Message },
  GotReviewMessage: { message: Review.Message },
  GotStylistMessage: { message: Stylist.Message },
  GotLooksMessage: { message: Looks.Message },
  GotLookMessage: { message: Look.Message },
  GotProfileMessage: { message: ProfileEditor.Message },
  GotTodayMessage: { message: Today.Message },
  GotAskMessage: { message: Ask.Message },
  GotBoardsMessage: { message: Boards.Message },
  GotBoardMessage: { message: BoardMessage.Message },
  GotVisitMessage: { message: Visit.Message },
  GotWishlistMessage: { message: Wishlist.Message },
  ChoseTelemetryConsent: { granted: Schema.Boolean },
  RecordedTelemetryConsent: { granted: Schema.Boolean },
  OpenedTelemetrySettings: {},
})
export type Message = typeof Message.Type
