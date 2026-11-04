import { Operation } from './Ids.ts'
import { LimitReached, NotFound, OperationConflict, SlowDown, Unavailable } from './Errors.ts'
import { SessionHttp } from '@styld/auth/config'
import { SessionAccount } from './Session.ts'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { CaptureApi } from './CaptureApi.ts'
import { StylistApi } from './StylistApi.ts'
import { ProfileNotPublished, SetVisibility, ShareLook } from './Check.ts'
import { Explore, ExploreQuery, SearchQuery, SearchResults } from './Explore.ts'
import {
  Handle,
  HandleReserved,
  HandleTaken,
  Profile,
  ProfileNeedsHandle,
  PublishProfile,
  UpdateProfile,
} from './Profile.ts'
import { GenerationApi } from './Generation.ts'
import { LinkApi } from './Link.ts'
import { ImportApi } from './Import.ts'
import {
  CreateReport,
  Feed,
  FeedQuery,
  NotWithYourself,
  People,
  Relation,
  Saved,
  SavedState,
  SetBlocked,
  SetFollowing,
  SetSaved,
} from './Social.ts'
import { PageMeta, PageMetaQuery, PublicBoard, PublicLookPage, PublicPiecePage, PublicProfile } from './Public.ts'
import {
  AddBoardImage,
  AddPins,
  Board,
  BoardId,
  BoardImage,
  BoardItemRefused,
  BoardVersionConflict,
  Boards,
  CreateBoard,
  KeepLook,
  KeptLook,
  PinRefused,
  RemovePins,
  SaveBoardItems,
  UpdateBoard,
} from './Board.ts'
import { CreateLook, Look, LookId, Looks } from './Look.ts'
import { OutfitApi } from './Outfit.ts'
import { PhotoApi } from './Photo.ts'
import { Day } from './Day.ts'
import { WearPieces, WornDay, WornDays, WornRange } from './Worn.ts'
import {
  AddPiece,
  ChoosePicture,
  CreateUpload,
  CreateVideoUpload,
  NoCleanPicture,
  Piece,
  PieceId,
  Pieces,
  SetBack,
  UpdatePiece,
  RenameCategory,
  DeleteCategory,
  Upload,
  UploadRefused,
} from './Wardrobe.ts'

/** The signed-in person's account: deleting it. */
class AccountApi extends HttpApiGroup.make('account')
  /** Delete the account, its wardrobe and photos, its sessions and assistants' access, for good. */
  .add(
    HttpApiEndpoint.delete('deleteMe', '/me', {
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: Unavailable,
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}

/** The signed-in person's pieces. A photo goes up first (`createUpload`, then a `PUT` of its bytes
 * to the returned path) and becomes a piece with `addPiece`. */
class WardrobeApi extends HttpApiGroup.make('wardrobe')
  .add(HttpApiEndpoint.get('listPieces', '/pieces', { success: Pieces, error: Unavailable }))
  .add(
    HttpApiEndpoint.get('getPiece', '/pieces/:pieceId', {
      params: { pieceId: PieceId },
      success: Piece,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('createUpload', '/uploads', {
      payload: CreateUpload,
      success: Upload,
      error: [UploadRefused, LimitReached, SlowDown, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('createVideoUpload', '/uploads/video', {
      payload: CreateVideoUpload,
      success: Upload,
      error: [UploadRefused, LimitReached, SlowDown, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('addPiece', '/pieces', {
      payload: AddPiece,
      success: Piece,
      error: [UploadRefused, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.patch('updatePiece', '/pieces/:pieceId', {
      params: { pieceId: PieceId },
      payload: UpdatePiece,
      success: Piece,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.patch('renameCategory', '/categories', {
      payload: RenameCategory,
      success: HttpApiSchema.NoContent,
      error: [OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('deleteCategory', '/categories', {
      payload: DeleteCategory,
      success: HttpApiSchema.NoContent,
      error: [OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('deletePiece', '/pieces/:pieceId', {
      params: { pieceId: PieceId },
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.put('setBack', '/pieces/:pieceId/back', {
      params: { pieceId: PieceId },
      payload: SetBack,
      success: Piece,
      error: [NotFound, UploadRefused, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('removeBack', '/pieces/:pieceId/back', {
      params: { pieceId: PieceId },
      payload: Operation,
      success: Piece,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.put('choosePicture', '/pieces/:pieceId/picture', {
      params: { pieceId: PieceId },
      payload: ChoosePicture,
      success: Piece,
      error: [NotFound, NoCleanPicture, OperationConflict, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}

/** Looks: outfits from the person's own pieces. Assistants make them, and so does the website when a
 * board or today's table is saved as a look. */
class LookApi extends HttpApiGroup.make('look')
  .add(HttpApiEndpoint.get('listLooks', '/looks', { success: Looks, error: Unavailable }))
  .add(
    /** The person's looks one of their pieces is in, newest first: a piece's "In your looks". */
    HttpApiEndpoint.get('pieceLooks', '/pieces/:pieceId/looks', {
      params: { pieceId: PieceId },
      success: Looks,
      error: Unavailable,
    }),
  )
  .add(
    HttpApiEndpoint.post('createLook', '/looks', {
      payload: CreateLook,
      success: Look,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('getLook', '/looks/:lookId', {
      params: { lookId: LookId },
      success: Look,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('deleteLook', '/looks/:lookId', {
      params: { lookId: LookId },
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.put('shareLook', '/looks/:lookId/shared', {
      params: { lookId: LookId },
      payload: ShareLook,
      success: Look,
      error: [NotFound, ProfileNotPublished, OperationConflict, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}

/** Boards: the pieces, looks and pictures the person pins, and the table they lay some of them on. A picture
 * goes up as a photo upload first (`wardrobe.createUpload`, then a `PUT`) and joins the board with
 * `addBoardImage`. */
class BoardApi extends HttpApiGroup.make('board')
  .add(HttpApiEndpoint.get('listBoards', '/boards', { success: Boards, error: Unavailable }))
  .add(
    HttpApiEndpoint.post('createBoard', '/boards', {
      payload: CreateBoard,
      success: Board,
      error: [OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('getBoard', '/boards/:boardId', {
      params: { boardId: BoardId },
      success: Board,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.patch('updateBoard', '/boards/:boardId', {
      params: { boardId: BoardId },
      payload: UpdateBoard,
      success: Board,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('deleteBoard', '/boards/:boardId', {
      params: { boardId: BoardId },
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.put('saveBoardItems', '/boards/:boardId/items', {
      params: { boardId: BoardId },
      payload: SaveBoardItems,
      success: Board,
      error: [NotFound, BoardVersionConflict, BoardItemRefused, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('addPins', '/boards/:boardId/pins', {
      params: { boardId: BoardId },
      payload: AddPins,
      success: Board,
      error: [NotFound, PinRefused, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('keepLook', '/boards/:boardId/looks', {
      params: { boardId: BoardId },
      payload: KeepLook,
      success: KeptLook,
      error: [NotFound, PinRefused, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('removePins', '/boards/:boardId/pins/remove', {
      params: { boardId: BoardId },
      payload: RemovePins,
      success: Board,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.put('setBoardVisibility', '/boards/:boardId/visibility', {
      params: { boardId: BoardId },
      payload: SetVisibility,
      success: Board,
      error: [NotFound, ProfileNotPublished, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('addBoardImage', '/boards/:boardId/images', {
      params: { boardId: BoardId },
      payload: AddBoardImage,
      success: BoardImage,
      error: [NotFound, UploadRefused, OperationConflict, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}

/** What the person wore, by day: "Wear this" on today's table records it. */
class WornApi extends HttpApiGroup.make('worn')
  .add(
    HttpApiEndpoint.get('listWorn', '/worn', {
      query: WornRange,
      success: WornDays,
      error: Unavailable,
    }),
  )
  .add(
    HttpApiEndpoint.put('wearPieces', '/worn/:day', {
      params: { day: Day },
      payload: WearPieces,
      success: WornDay,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('clearWorn', '/worn/:day', {
      params: { day: Day },
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: [OperationConflict, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}

/** The person's public profile: a handle, a name, a city and a bio, published or not. */
class ProfileApi extends HttpApiGroup.make('profile')
  .add(HttpApiEndpoint.get('getProfile', '/profile', { success: Profile, error: Unavailable }))
  .add(
    HttpApiEndpoint.patch('updateProfile', '/profile', {
      payload: UpdateProfile,
      success: Profile,
      error: [HandleTaken, HandleReserved, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.put('publishProfile', '/profile/published', {
      payload: PublishProfile,
      success: Profile,
      error: [ProfileNeedsHandle, OperationConflict, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}

/** What anyone may read, signed in or not: published profiles, public boards, shared looks and their pieces. */
class PublicApi extends HttpApiGroup.make('public')
  .add(
    HttpApiEndpoint.get('profile', '/public/profiles/:handle', {
      params: { handle: Handle },
      success: PublicProfile,
      error: [NotFound, SlowDown, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('board', '/public/boards/:boardId', {
      params: { boardId: BoardId },
      success: PublicBoard,
      error: [NotFound, SlowDown, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('look', '/public/looks/:lookId', {
      params: { lookId: LookId },
      success: PublicLookPage,
      error: [NotFound, SlowDown, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('piece', '/public/pieces/:pieceId', {
      params: { pieceId: PieceId },
      success: PublicPiecePage,
      error: [NotFound, SlowDown, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('explore', '/public/explore', {
      query: ExploreQuery,
      success: Explore,
      error: [SlowDown, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('search', '/public/search', {
      query: SearchQuery,
      success: SearchResults,
      error: [SlowDown, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('meta', '/public/meta', {
      query: PageMetaQuery,
      success: PageMeta,
      error: [NotFound, SlowDown, Unavailable],
    }),
  ) {}

/** What the person does with others: saves, follows, blocks, reports and the Following feed. */
class SocialApi extends HttpApiGroup.make('social')
  .add(HttpApiEndpoint.get('listSaved', '/saved', { success: Saved, error: Unavailable }))
  .add(
    HttpApiEndpoint.put('setSaved', '/saved', {
      payload: SetSaved,
      success: SavedState,
      error: [NotFound, NotWithYourself, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('relation', '/people/:handle', {
      params: { handle: Handle },
      success: Relation,
      error: [NotFound, NotWithYourself, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.put('setFollowing', '/people/:handle/following', {
      params: { handle: Handle },
      payload: SetFollowing,
      success: Relation,
      error: [NotFound, NotWithYourself, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.put('setBlocked', '/people/:handle/blocked', {
      params: { handle: Handle },
      payload: SetBlocked,
      success: Relation,
      error: [NotFound, NotWithYourself, OperationConflict, Unavailable],
    }),
  )
  .add(HttpApiEndpoint.get('following', '/following', { success: People, error: Unavailable }))
  .add(HttpApiEndpoint.get('blocked', '/blocked', { success: People, error: Unavailable }))
  .add(
    HttpApiEndpoint.post('report', '/reports', {
      payload: CreateReport,
      success: HttpApiSchema.NoContent,
      error: [NotFound, NotWithYourself, LimitReached, OperationConflict, Unavailable],
    }),
  )
  .add(HttpApiEndpoint.get('feed', '/feed', { query: FeedQuery, success: Feed, error: Unavailable }))
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}

/** Styld's typed HTTP API: declared once, served by the API Worker and called by the website. */
export class StyldApi extends HttpApi.make('styld')
  .add(AccountApi)
  .add(WardrobeApi)
  .add(CaptureApi)
  .add(LookApi)
  .add(BoardApi)
  .add(WornApi)
  .add(ProfileApi)
  .add(PublicApi)
  .add(SocialApi)
  .add(LinkApi)
  .add(GenerationApi)
  .add(StylistApi)
  .add(OutfitApi)
  .add(PhotoApi)
  .add(ImportApi)
  .prefix('/api') {}
