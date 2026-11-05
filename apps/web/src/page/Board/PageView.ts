import { format, type Locale } from '@styld/i18n'
import { type Paper, type PublicBoard } from '@styld/protocol'
import { Array, Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { backIcon } from '../../Icon.ts'
import { boardRouter, boardsRouter } from '../../route.ts'
import { styled } from '../../Styled.ts'
import * as PeopleView from '../PeopleView.ts'
import * as Share from '../Share.ts'
import { checkNotice } from '../CheckNotice.ts'
import type * as Chrome from './Chrome.ts'
import * as ChromeView from './ChromeView.ts'
import { Message } from './Message.ts'
import { boardStateView } from './Unready.ts'
import { visitingView } from './Visiting.ts'
import * as TryItView from './TryItView.ts'
import { type Model, canChangePins, PinWork, Upload } from './Model.ts'
import * as MakeView from './MakeView.ts'
import * as OutfitsView from './OutfitsView.ts'
import * as styles from './PageView.styles.ts'
import { editorView } from './View.ts'
import { saveLookView } from './ViewTools.ts'
import type { PiecesData } from '../../ServerData.ts'

/** Its pins and who sees it; public, how many of them others see when that is fewer (a piece shows others only with a
 * picture of its own, once Styld's check lets it). */
const statusLine = (model: Model, locale: Locale) => {
  const count = model.pins.length
  const shown = model.publicPins.length
  return model.visibility === 'public' && shown < count
    ? format(locale, 'studio.boardStatusPartly', { count, shown })
    : format(locale, 'studio.boardStatus', { count, visibility: model.visibility })
}

/** Share (Eva's review, T-20): a public board's link through the share sheet. A private board has nothing to show
 * anyone yet; the switch beside it makes it public. */
const shareAction = (model: Model, name: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  model.visibility === 'public'
    ? h.submodel({
        slotId: 'board-share',
        model: model.sharing,
        view: Share.buttonView,
        viewInputs: { locale, path: boardRouter({ boardId: model.boardId }), title: name, look: 'small' },
        toParentMessage: (message) => Message.GotShareMessage({ message }),
      })
    : h.empty

/** One part of Make with Styld on the page: its button, its status or its sheet. */
const makeSlot = (
  slotId: string,
  view: typeof MakeView.buttonView,
  model: Model,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId,
    model: model.make,
    view,
    viewInputs: { locale },
    toParentMessage: (message) => Message.GotMakeMessage({ message }),
  })

/** A "One piece, many outfits" board's outfits as cards under its table (T-10); nothing on a blank board. */
const outfitsSlot = (model: Model, name: string, paper: Paper, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'board-outfits',
    model: model.outfits,
    view: OutfitsView.view,
    viewInputs: { locale, boardName: name, paper },
    toParentMessage: (message) => Message.GotOutfitsMessage({ message }),
  })

const toChrome = (message: Chrome.Message) => Message.GotChromeMessage({ message })

const readyView = (
  model: Model,
  pieces: PiecesData,
  name: string,
  paper: Paper,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(styled(h, styles.page()), [
    h.div(styled(h, styles.bar()), [
      h.a(
        [h.Href(boardsRouter({})), ...styled(h, styles.back())],
        [backIcon(h), format(locale, 'studio.backToBoards', {})],
      ),
      h.div(styled(h, styles.barActions()), [
        h.submodel({
          slotId: 'board-public-switch',
          model: model.chrome,
          view: ChromeView.publicView,
          viewInputs: { locale, visibility: model.visibility, check: model.check },
          toParentMessage: toChrome,
        }),
        shareAction(model, name, locale, h),
        h.submodel({
          slotId: 'board-more-button',
          model: model.chrome,
          view: ChromeView.moreButtonView,
          viewInputs: { locale },
          toParentMessage: toChrome,
        }),
      ]),
    ]),
    h.div(styled(h, styles.head()), [
      h.submodel({
        slotId: 'board-title',
        model: model.chrome,
        view: ChromeView.titleView,
        viewInputs: { locale, name },
        toParentMessage: toChrome,
      }),
      // Where it stands, in one quiet line (DESIGN › Your public things), then the check's word on it.
      h.p(styled(h, styles.meta()), [statusLine(model, locale)]),
      model.visibility === 'public' ? checkNotice(Option.getOrNull(model.check), locale, h) : h.empty,
      Share.statusView(model.sharing, locale, h),
      makeSlot('board-make-status', MakeView.statusView, model, locale, h),
    ]),
    h.div(styled(h, styles.barActions()), [
      saveLookView(model, locale, h),
      makeSlot('board-make-button', MakeView.buttonView, model, locale, h),
    ]),
    editorView(model, pieces, paper, locale, h),
    outfitsSlot(model, name, paper, locale, h),
    h.submodel({
      slotId: 'board-more-sheet',
      model: model.chrome,
      view: ChromeView.sheetView,
      viewInputs: {
        locale,
        name,
        visibility: model.visibility,
        check: model.check,
        pins: model.pins,
        publicPins: model.publicPins,
        pinsFailed: PinWork.guards.Failed(model.pinWork),
        canChangePins: canChangePins(model),
        canTidy: Array.isReadonlyArrayNonEmpty(model.items),
        canPaste: !model.isPasting && !Upload.guards.Sending(model.upload),
      },
      toParentMessage: toChrome,
    }),
    makeSlot('board-make-sheet', MakeView.sheetView, model, locale, h),
  ])

/** Owners edit the board immediately; visitors see its public presentation. */
export const view = Submodel.defineView<Model, Message, PeopleView.Inputs & { readonly pieces: PiecesData }>(
  (model, { locale, signedIn, pieces }, h) => {
    const actions = h.submodel({
      slotId: 'board-people',
      model: model.people,
      view: PeopleView.view,
      viewInputs: { locale, signedIn },
      toParentMessage: (message) => Message.GotPeopleMessage({ message }),
    })
    const visiting = (board: PublicBoard) =>
      visitingView(
        board,
        actions,
        h.submodel({
          slotId: 'board-try',
          model: model.tryIt,
          view: TryItView.view,
          viewInputs: { locale, signedIn, board },
          toParentMessage: (message) => Message.GotTryItMessage({ message }),
        }),
        locale,
        h,
      )
    return boardStateView(
      model.board,
      (name, paper) => readyView(model, pieces, name, paper, locale, h),
      locale,
      h,
      Option.some(visiting),
      signedIn,
    )
  },
)
