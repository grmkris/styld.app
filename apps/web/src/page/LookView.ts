import { format, type Locale } from '@styld/i18n'
import type { Look, PublicLookPage } from '@styld/protocol'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { linkAction, secondaryAction } from '../Actions.styles.ts'
import { confirmActions } from '../ConfirmActions.ts'
import { formError } from '../Fields.styles.ts'
import { backIcon, loader } from '../Icon.ts'
import { looksRouter, pieceRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { Deletion, Message, type Model, Sharing, Shown } from './Look.ts'
import { checkNotice } from './CheckNotice.ts'
import { publicToggle } from './PublicToggle.ts'
import * as PeopleView from './PeopleView.ts'
import { byline, pieceTile, tileGrid } from './PublicTiles.ts'
import * as SaveToBoardView from './SaveToBoardView.ts'
import { round } from './PageBar.styles.ts'
import { pieceLabel } from './WardrobeWords.ts'
import { collage, couldNotLoad } from './LooksView.ts'
import { categoryName } from './WardrobeWords.ts'
import { cx } from 'zyzz'
import * as styles from './LooksView.styles.ts'

const backToLooks = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(looksRouter({})), h.AriaLabel(format(locale, 'looks.backToLooks', {})), ...styled(h, round())],
    [backIcon(h)],
  )

/** Delete is quiet, at the end, and asks first. */
const deletion = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Deletion.match(model.deletion, {
    Idle: () => [
      actionButton(
        {
          label: format(locale, 'looks.delete', {}),
          style: cx(linkAction(), styles.quietAction()),
          onClick: Message.ClickedDelete(),
        },
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

/** The look's pieces as rows (Gallery `outfit.html` › piece rows): each cutout small on paper, its name and kind. */
const pieceRows = (look: Look, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('look-pieces'), ...styled(h, styles.pieces())],
    [
      h.h2([h.Id('look-pieces'), ...styled(h, styles.piecesTitle())], [format(locale, 'looks.piecesTitle', {})]),
      h.ul(
        styled(h, styles.pieceRows()),
        look.pieces.map((piece) =>
          h.keyed('li')(
            piece.id,
            [],
            [
              h.a(
                [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, styles.pieceRow())],
                [
                  h.img([
                    h.Src(`/cdn/pieces/${piece.id}/thumb`),
                    h.Alt(''),
                    h.Loading('lazy'),
                    ...styled(h, styles.pieceRowImage()),
                  ]),
                  h.span(styled(h, styles.pieceRowText()), [
                    h.span(styled(h, styles.pieceRowName()), [pieceLabel(piece, locale)]),
                    h.span(styled(h, styles.cardMeta()), [format(locale, categoryName(piece.category), {})]),
                  ]),
                ],
              ),
            ],
          ),
        ),
      ),
    ],
  )

/** One look: its name and where it stands, the look laid out, saving and sharing it, its pieces, and deleting it. */
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
          // Where it stands, in one quiet line under the title (DESIGN › Your public things), then the check.
          h.p(styled(h, styles.status()), [
            format(locale, look.shared ? 'looks.statusPublic' : 'looks.statusPrivate', {}),
          ]),
          look.shared ? checkNotice(look.check, locale, h) : h.empty,
          look.occasion === null ? h.empty : h.p(styled(h, styles.lede()), [look.occasion]),
          h.div(styled(h, styles.lookCollage()), [collage(look, h)]),
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
              describe: false,
              onToggle: (shared) => Message.ToggledShared({ shared }),
            },
            locale,
            h,
          ),
          pieceRows(look, locale, h),
          h.div(styled(h, styles.deletion()), deletion(model, locale, h)),
        ],
      }),
    ],
  ),
)
