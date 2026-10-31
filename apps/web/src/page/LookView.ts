import { format, type Locale } from '@styld/i18n'
import type { PublicLookPage } from '@styld/protocol'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { confirmActions } from '../ConfirmActions.ts'
import { formError } from '../Fields.styles.ts'
import { backIcon, loader } from '../Icon.ts'
import { looksRouter, pieceRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { Deletion, Message, type Model, Sharing, Shown } from './Look.ts'
import { publicToggle } from './PublicToggle.ts'
import * as PeopleView from './PeopleView.ts'
import { byline, pieceTile, tileGrid } from './PublicTiles.ts'
import * as SaveToBoardView from './SaveToBoardView.ts'
import { round } from './PageBar.styles.ts'
import { pieceLabel } from './WardrobeWords.ts'
import { caption, cut, cutImage, grid } from './WardrobeView.styles.ts'
import { couldNotLoad } from './LooksView.ts'
import * as styles from './LooksView.styles.ts'

const backToLooks = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(looksRouter({})), h.AriaLabel(format(locale, 'looks.backToLooks', {})), ...styled(h, round())],
    [backIcon(h)],
  )

const deletion = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Deletion.match(model.deletion, {
    Idle: () => [
      actionButton(
        { label: format(locale, 'looks.delete', {}), style: secondaryAction(), onClick: Message.ClickedDelete() },
        h,
      ),
    ],
    Failed: () => [
      h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'looks.deleteFailed', {})]),
      actionButton(
        { label: format(locale, 'looks.delete', {}), style: secondaryAction(), onClick: Message.ClickedDelete() },
        h,
      ),
    ],
    Confirming: () => [
      h.p([], [format(locale, 'looks.deleteConfirm', {})]),
      ...confirmActions(
        {
          confirm: format(locale, 'looks.delete', {}),
          cancel: format(locale, 'common.cancel', {}),
          onConfirm: Message.ClickedConfirmDelete(),
          onCancel: Message.ClickedCancelDelete(),
          busy: false,
        },
        h,
      ),
    ],
    Deleting: () =>
      confirmActions(
        {
          confirm: format(locale, 'looks.delete', {}),
          cancel: format(locale, 'common.cancel', {}),
          onConfirm: Message.ClickedConfirmDelete(),
          onCancel: Message.ClickedCancelDelete(),
          busy: true,
        },
        h,
      ),
  })

/** Someone else's shared look: its name, occasion and whose it is, what a visitor can do, and its pieces. */
const visitingView = (
  model: Model,
  page: PublicLookPage,
  { locale, signedIn }: PeopleView.Inputs,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.h1([], [page.look.name]),
  page.look.occasion === null ? h.empty : h.p(styled(h, styles.lede()), [page.look.occasion]),
  byline(page.by, locale, h),
  h.submodel({
    slotId: 'look-people',
    model: model.people,
    view: PeopleView.view,
    viewInputs: { locale, signedIn },
    toParentMessage: (message) => Message.GotPeopleMessage({ message }),
  }),
  tileGrid(
    page.look.pieces.map((piece) => ({ id: piece.id, tile: pieceTile(piece, locale, h) })),
    h,
  ),
]

/** One look: its name and occasion, its pieces, and deleting it. */
export const view = Submodel.defineView<Model, Message, PeopleView.Inputs>((model, { locale, signedIn }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.looksPage())],
    [
      Shown.guards.Visiting(model.shown) ? h.empty : h.div([], [backToLooks(locale, h)]),
      ...Shown.match(model.shown, {
        Loading: () => [h.p([h.Role('status')], [loader(h)])],
        NotFound: () => [h.h1([], [format(locale, 'looks.notFound', {})])],
        Visiting: ({ page }) => visitingView(model, page, { locale, signedIn }, h),
        Failed: () => [
          h.h1([], [format(locale, 'looks.title', {})]),
          couldNotLoad(format(locale, 'looks.loadFailed', {}), locale, h, Message.ClickedRetry()),
        ],
        Loaded: ({ look }) => [
          h.h1([], [look.name]),
          look.occasion === null ? h.empty : h.p(styled(h, styles.lede()), [look.occasion]),
          h.ul(
            styled(h, grid()),
            look.pieces.map((piece) =>
              h.keyed('li')(
                piece.id,
                [],
                [
                  h.a(
                    [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, cut())],
                    [
                      h.img([
                        h.Src(`/cdn/pieces/${piece.id}/thumb`),
                        h.Alt(pieceLabel(piece, locale)),
                        h.Loading('lazy'),
                        ...styled(h, cutImage()),
                      ]),
                      h.span(styled(h, caption()), [pieceLabel(piece, locale)]),
                    ],
                  ),
                ],
              ),
            ),
          ),
          h.submodel({
            slotId: 'look-save-to-board',
            model: model.saveToBoard,
            view: SaveToBoardView.view,
            viewInputs: { locale },
            toParentMessage: (message) => Message.GotSaveToBoardMessage({ message }),
          }),
          publicToggle(
            {
              id: 'look-public',
              isPublic: look.shared,
              check: look.check,
              work: Sharing.match(model.sharing, {
                Idle: () => 'idle' as const,
                Sending: () => 'sending' as const,
                Failed: ({ needsProfile }) => (needsProfile ? ('needsProfile' as const) : ('failed' as const)),
              }),
              onToggle: (shared) => Message.ToggledShared({ shared }),
            },
            locale,
            h,
          ),
          h.div([], deletion(model, locale, h)),
        ],
      }),
    ],
  ),
)
