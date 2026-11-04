import { format, type Locale } from '@styld/i18n'
import { type Audience, type FoundBoard, Occasion } from '@styld/protocol'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction, secondaryAction } from '../Actions.styles.ts'
import { styled } from '../Styled.ts'
import { boardsAsked, dialogId, HoldFirstRun, isPicked, Message, type Model, Stage, Step } from './FirstRun.ts'
import * as styles from './FirstRunView.styles.ts'
import { publicFace } from './PublicTiles.ts'
import { occasionName } from './WardrobeWords.ts'

const showMeChoices = [
  { showMe: 'women', key: 'showMe.women' },
  { showMe: 'men', key: 'showMe.men' },
  { showMe: 'all', key: 'showMe.all' },
] as const satisfies ReadonlyArray<{ readonly showMe: Audience; readonly key: string }>

/** Which step of the four it is. */
const stepNumber = (step: Step) =>
  Step.match(step, { ShowMe: () => 1, Boards: () => 2, Occasions: () => 3, Clothes: () => 4 })

/** Step 1: what What's new shows first, as Home's card asks it; Skip answers "Not now". */
const showMeStep = (locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.h2([h.Id('first-run-title'), ...styled(h, styles.title())], [format(locale, 'showMe.title', {})]),
  h.p(styled(h, styles.reason()), [format(locale, 'showMe.reason', {})]),
  h.div(
    styled(h, styles.actions()),
    showMeChoices.map(({ showMe, key }) =>
      actionButton(
        { label: format(locale, key, {}), style: secondaryAction(), onClick: Message.ClickedShowMe({ showMe }) },
        h,
      ),
    ),
  ),
  actionButton(
    {
      label: format(locale, 'firstRun.skip', {}),
      style: linkAction(),
      onClick: Message.ClickedShowMe({ showMe: null }),
    },
    h,
  ),
]

/** One house board to pick, its face and name, pressed once picked. */
const boardChoice = (model: Model, found: FoundBoard, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    found.board.id,
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaPressed(isPicked(model, found.board.id) ? 'true' : 'false'),
          h.OnClick(Message.ClickedBoard({ boardId: found.board.id })),
          ...styled(h, styles.board()),
        ],
        [publicFace(found.board, locale, h), h.span([], [found.board.name])],
      ),
    ],
  )

/** Step 2: house boards to save; none read yet shows the words alone. */
const boardsStep = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.h2(
    [h.Id('first-run-title'), ...styled(h, styles.title())],
    [format(locale, 'firstRun.boardsTitle', { count: boardsAsked })],
  ),
  h.p(styled(h, styles.reason()), [format(locale, 'firstRun.boardsReason', {})]),
  model.boards.length === 0
    ? h.p([h.Role('status'), ...styled(h, styles.reason())], [format(locale, 'firstRun.boardsLoading', {})])
    : h.ul(
        styled(h, styles.boards()),
        model.boards.map((found) => boardChoice(model, found, locale, h)),
      ),
  nextRow(locale, h),
]

/** Step 3: the occasions they dress for. */
const occasionsStep = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.h2([h.Id('first-run-title'), ...styled(h, styles.title())], [format(locale, 'firstRun.occasionsTitle', {})]),
  h.p(styled(h, styles.reason()), [format(locale, 'firstRun.occasionsReason', {})]),
  h.div(
    [h.Role('group'), h.AriaLabelledBy('first-run-title'), ...styled(h, styles.chips())],
    Occasion.literals.map((occasion) =>
      actionButton(
        {
          label: format(locale, occasionName(occasion), {}),
          style: cx(styles.chip(), styles.chosen()),
          pressed: model.occasions.includes(occasion),
          onClick: Message.ClickedOccasion({ occasion }),
        },
        h,
      ),
    ),
  ),
  nextRow(locale, h),
]

/** Step 4: their own clothes. Done closes the first run onto Home, whose first-piece card is the way into Add clothes
 * (owner, 4 November 2026: one way in). */
const clothesStep = (locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.h2([h.Id('first-run-title'), ...styled(h, styles.title())], [format(locale, 'firstRun.clothesTitle', {})]),
  h.p(styled(h, styles.reason()), [format(locale, 'firstRun.clothesReason', {})]),
  h.div(styled(h, styles.actions()), [
    actionButton(
      { label: format(locale, 'firstRun.done', {}), style: primaryAction(), onClick: Message.ClickedNext() },
      h,
    ),
  ]),
]

/** Next, and Skip all. */
const nextRow = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.actions()), [
    actionButton(
      { label: format(locale, 'firstRun.next', {}), style: primaryAction(), onClick: Message.ClickedNext() },
      h,
    ),
    actionButton(
      { label: format(locale, 'firstRun.skipAll', {}), style: linkAction(), onClick: Message.ClickedSkipAll() },
      h,
    ),
  ])

/** The first run over Home, while it is open: a modal screen, its step counted, Escape skipping the rest. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  Stage.guards.Open(model.stage)
    ? h.dialog(
        [
          h.Id(dialogId),
          h.AriaLabelledBy('first-run-title'),
          h.OnMount(HoldFirstRun()),
          h.OnCancelPreventDefault(Message.ClickedSkipAll()),
          ...styled(h, styles.screen()),
        ],
        [
          h.div(styled(h, styles.column()), [
            h.p(styled(h, styles.step()), [
              format(locale, 'firstRun.step', { at: stepNumber(model.stage.step), of: 4 }),
            ]),
            ...Step.match(model.stage.step, {
              ShowMe: () => showMeStep(locale, h),
              Boards: () => boardsStep(model, locale, h),
              Occasions: () => occasionsStep(model, locale, h),
              Clothes: () => clothesStep(locale, h),
            }),
          ]),
        ],
      )
    : h.empty,
)
