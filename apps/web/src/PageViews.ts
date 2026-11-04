import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { hasSession, Message, type Model } from './App.ts'
import { piecesById } from './Cdn.ts'
import { landingView } from './Landing.ts'
import { lenses, type PageLens } from './Page.ts'
import * as AddPiecesView from './page/AddPieces/View.ts'
import { accountView } from './page/AccountView.ts'
import * as AskView from './page/AskView.ts'
import * as BoardPageView from './page/Board/PageView.ts'
import * as BoardsView from './page/BoardsView.ts'
import * as LoginView from './page/LoginView.ts'
import * as LooksView from './page/LooksView.ts'
import * as LookView from './page/LookView.ts'
import * as PhotosView from './page/PhotosView.ts'
import * as PhotoView from './page/PhotoView.ts'
import * as PieceView from './page/PieceView.ts'
import * as ProfileEditorView from './page/ProfileEditorView.ts'
import * as ReviewView from './page/ReviewView.ts'
import * as StylistView from './page/StylistView.ts'
import * as TodayView from './page/TodayView.ts'
import type * as Visit from './page/Visit.ts'
import * as VisitView from './page/VisitView.ts'
import * as WardrobeView from './page/WardrobeView.ts'
import { pieceLabel } from './page/WardrobeWords.ts'
import { AppRoute, homeRouter, parentReturn } from './route.ts'
import { piecesOf } from './ServerData.ts'
import { categoriesOf } from './page/PieceFields.ts'
import { styled } from './Styled.ts'
import { intro } from './View.styles.ts'

// The open page's view, through its lens (Page.ts): each page draws its own Model with the inputs the app computes.

const notFoundView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.main(
    [h.Id('main'), ...styled(h, intro())],
    [
      h.h1([], [format(locale, 'common.notFoundTitle', {})]),
      h.p([], [format(locale, 'common.notFoundDescription', {})]),
      h.a([h.Href(homeRouter({}))], [format(locale, 'common.goHome', {})]),
    ],
  )

/** What `h.submodel` takes from a page's lens: its slot, its Model and how its Messages reach the app. */
const slot = <Child, ChildMessage>(lens: PageLens<Child, ChildMessage>, child: Child) => ({
  slotId: lens.slot,
  model: child,
  toParentMessage: lens.toParentMessage,
})

/** The open page's view through its lens; nothing while another page is open. */
const onPage = <Child>(
  model: Model,
  lens: PageLens<Child, never>,
  render: (child: Child) => Html,
  h: HtmlBuilder<Message>,
): Html => Option.match(lens.read(model.page), { onNone: () => h.empty, onSome: render })

/** The person's pieces by id, named as the wardrobe names them, for the pieces Styld shows. */
const pieceNames = (model: Model): ReadonlyMap<string, string> =>
  new Map(piecesOf(model.data).map((piece) => [piece.id, pieceLabel(piece, model.context.locale)]))

/** Home: today's table for a signed-in person, the landing page for everyone else. While the session is read,
 * a request that came with a session cookie waits quietly instead of flashing the landing page. */
const homePage = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  const { pieces } = model.data
  return hasSession(model)
    ? onPage(
        model,
        lenses.today,
        (today) =>
          h.submodel({
            ...slot(lenses.today, today),
            view: TodayView.view,
            viewInputs: {
              locale,
              pieces,
              boards: model.data.boards,
              showMeAnswered: model.context.showMeAnswered === true,
            },
          }),
        h,
      )
    : onPage(model, lenses.landing, (landing) => landingView(landing, locale, h), h)
}

/** Someone's public profile or piece. */
const visitPage = (model: Model, lens: PageLens<Visit.Model, Visit.Message>, h: HtmlBuilder<Message>): Html =>
  onPage(
    model,
    lens,
    (visit) =>
      h.submodel({
        ...slot(lens, visit),
        view: VisitView.view,
        viewInputs: { locale: model.context.locale, signedIn: hasSession(model) },
      }),
    h,
  )

const loginPage = (model: Model, forConnection: boolean, h: HtmlBuilder<Message>): Html =>
  onPage(
    model,
    lenses.login,
    (login) =>
      h.submodel({
        ...slot(lenses.login, login),
        view: LoginView.view,
        viewInputs: { forConnection, locale: model.context.locale },
      }),
    h,
  )

/** The tab pages: each shows its own Model, as the person left it. */
const tabPages = (model: Model, h: HtmlBuilder<Message>) => {
  const { locale, timeZone } = model.context
  const { pieces } = model.data
  return {
    Home: () => homePage(model, h),
    Account: () => onPage(model, lenses.account, (account) => accountView(model, account, h), h),
    Wardrobe: () =>
      onPage(
        model,
        lenses.wardrobe,
        (wardrobe) =>
          h.submodel({ ...slot(lenses.wardrobe, wardrobe), view: WardrobeView.view, viewInputs: { locale, pieces } }),
        h,
      ),
    Looks: () =>
      onPage(
        model,
        lenses.looks,
        (looks) => h.submodel({ ...slot(lenses.looks, looks), view: LooksView.view, viewInputs: { locale } }),
        h,
      ),
    Photos: () =>
      onPage(
        model,
        lenses.photos,
        (photos) =>
          h.submodel({ ...slot(lenses.photos, photos), view: PhotosView.view, viewInputs: { locale, timeZone } }),
        h,
      ),
    Ask: () =>
      onPage(
        model,
        lenses.ask,
        (ask) =>
          h.submodel({
            ...slot(lenses.ask, ask),
            view: AskView.view,
            viewInputs: { locale, pieces },
          }),
        h,
      ),
    Boards: () =>
      onPage(
        model,
        lenses.boards,
        (boards) =>
          h.submodel({
            ...slot(lenses.boards, boards),
            view: BoardsView.view,
            viewInputs: { locale, boards: model.data.boards, pieces },
          }),
        h,
      ),
  }
}

/** The pages that load whole about the person's own wardrobe, and sign-in. */
const wardrobePages = (model: Model, h: HtmlBuilder<Message>) => {
  const { locale, timeZone } = model.context
  const signedIn = hasSession(model)
  const pieces = piecesOf(model.data)
  const categories = categoriesOf(pieces)
  return {
    Login: () => loginPage(model, false, h),
    LoginForConnection: () => loginPage(model, true, h),
    Profile: () =>
      onPage(
        model,
        lenses.profile,
        (profile) =>
          h.submodel({ ...slot(lenses.profile, profile), view: ProfileEditorView.view, viewInputs: { locale } }),
        h,
      ),
    AddPieces: () =>
      onPage(
        model,
        lenses.addPieces,
        (addPieces) =>
          h.submodel({ ...slot(lenses.addPieces, addPieces), view: AddPiecesView.view, viewInputs: { locale } }),
        h,
      ),
    Review: ({ from }: Extract<AppRoute, { readonly _tag: 'Review' }>) =>
      onPage(
        model,
        lenses.review,
        (review) =>
          h.submodel({
            ...slot(lenses.review, review),
            view: ReviewView.view,
            viewInputs: {
              locale,
              timeZone,
              images: piecesById(piecesOf(model.data)),
              returnTo: parentReturn(from, 'Photo'),
              categories,
            },
          }),
        h,
      ),
    Piece: ({ from }: Extract<AppRoute, { readonly _tag: 'Piece' }>) =>
      onPage(
        model,
        lenses.piece,
        (piece) =>
          h.submodel({
            ...slot(lenses.piece, piece),
            view: PieceView.view,
            viewInputs: { locale, boards: model.data.boards, returnTo: parentReturn(from, 'Wardrobe'), categories },
          }),
        h,
      ),
    Look: () =>
      onPage(
        model,
        lenses.look,
        (look) =>
          h.submodel({
            ...slot(lenses.look, look),
            view: LookView.view,
            viewInputs: { locale, signedIn, boards: model.data.boards },
          }),
        h,
      ),
    Photo: () =>
      onPage(
        model,
        lenses.photo,
        (photo) =>
          h.submodel({
            ...slot(lenses.photo, photo),
            view: PhotoView.view,
            viewInputs: { locale, timeZone, pieces, wardrobe: model.data.pieces, boards: model.data.boards },
          }),
        h,
      ),
  }
}

/** Ask's chat with Styld, a board and its collage, someone's public page, and a page that does not exist. */
const otherPages = (model: Model, h: HtmlBuilder<Message>) => {
  const { locale, timeZone } = model.context
  const signedIn = hasSession(model)
  return {
    Stylist: () =>
      onPage(
        model,
        lenses.stylist,
        (stylist) =>
          h.submodel({
            ...slot(lenses.stylist, stylist),
            view: StylistView.view,
            viewInputs: {
              locale,
              names: pieceNames(model),
              images: piecesById(piecesOf(model.data)),
              timeZone,
              referenceTime: model.context.referenceTime,
            },
          }),
        h,
      ),
    Board: () =>
      onPage(
        model,
        lenses.board,
        (board) =>
          h.submodel({
            ...slot(lenses.board, board),
            view: BoardPageView.view,
            viewInputs: { locale, signedIn, pieces: model.data.pieces },
          }),
        h,
      ),
    BoardCollage: () =>
      onPage(
        model,
        lenses.board,
        (board) =>
          h.submodel({
            ...slot(lenses.board, board),
            slotId: 'board-collage',
            view: BoardPageView.view,
            viewInputs: { locale, signedIn, pieces: model.data.pieces },
          }),
        h,
      ),
    Person: () => visitPage(model, lenses.visit, h),
    PublicPiece: () => visitPage(model, lenses.visit, h),
    NotFound: () => notFoundView(locale, h),
  }
}

/** The page the route shows. */
export const pageView = (model: Model, h: HtmlBuilder<Message>): Html =>
  AppRoute.match(model.route, { ...tabPages(model, h), ...wardrobePages(model, h), ...otherPages(model, h) })
