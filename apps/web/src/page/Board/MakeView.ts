import { format, type Locale, type MessageKey } from '@styld/i18n'
import { type Generation, type GenerationKind, mostMoodPictures } from '@styld/protocol'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import { cx } from 'zyzz'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../../ActionButton.ts'
import { primaryAction, secondaryAction, smallAction } from '../../Actions.styles.ts'
import { textArea, textField } from '../../Fields.styles.ts'
import { loader } from '../../Icon.ts'
import { styled } from '../../Styled.ts'
import { bottomSheet, sheetShown } from '../Sheet.ts'
import { canMake, Job, KindRadioGroup, kinds, type MakeProblem, Message, type Model } from './Make.ts'
import * as styles from './MakeView.styles.ts'

const problemKey: { readonly [Problem in MakeProblem]: MessageKey } = {
  dailyLimit: 'board.make.problem.dailyLimit',
  refused: 'board.make.problem.refused',
  slowDown: 'board.make.problem.slowDown',
  failed: 'board.make.problem.failed',
}

const kindKey: { readonly [Kind in GenerationKind]: { readonly title: MessageKey; readonly hint: MessageKey } } = {
  moodBoard: { title: 'board.make.moodBoard', hint: 'board.make.moodBoardHint' },
  picture: { title: 'board.make.picture', hint: 'board.make.pictureHint' },
}

/** What the chosen kind costs, as the server charges it: a credit held for each picture wanted (a mood board holds
 * up to its most), spent once the picture is on the board and given back for one that does not come out. */
const costOf = (kind: GenerationKind, locale: Locale): string =>
  kind === 'picture'
    ? format(locale, 'board.make.pictureCost', {})
    : format(locale, 'board.make.moodBoardCost', { most: mostMoodPictures })

type Inputs = { readonly locale: Locale }

/** The button on the board's bar that opens Make with Styld. */
// Its words say what it does; no sparkle at rest, since sparkles mark only AI at work (DESIGN.md › Copy and chrome).
export const buttonView = Submodel.defineView<Model, Message, Inputs>((model, { locale }, h) =>
  h.button(
    [
      h.Type('button'),
      h.AriaExpanded(model.sheet.isOpen),
      ...styled(h, cx(secondaryAction(), smallAction())),
      h.OnClick(Message.ClickedMake()),
    ],
    [format(locale, 'board.make.open', {})],
  ),
)

/** The mark under a picture Styld made. */
export const generatedMark = <Message>(locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.span(styled(h, styles.generated()), [format(locale, 'board.generated', {})])

const drawnCount = (generation: Generation) => generation.pictures.filter(({ status }) => status === 'drawn').length

/** How the ask is going, under the board's name: the work going on, what it added, or why it stopped. */
export const statusView = Submodel.defineView<Model, Message, Inputs>((model, { locale }, h) =>
  Job.match(model.job, {
    Idle: () => h.empty,
    Asking: () => h.empty,
    Running: ({ generation }) =>
      h.p(
        [h.Role('status'), ...styled(h, styles.status())],
        [
          loader(h),
          format(locale, generation.status === 'planning' ? 'board.make.planning' : 'board.make.drawing', {
            drawn: drawnCount(generation),
            total: generation.pictures.length,
          }),
        ],
      ),
    Finished: ({ generation }) =>
      h.p(
        [h.Role('status'), ...styled(h, styles.status())],
        [
          drawnCount(generation) > 0
            ? format(locale, 'board.make.added', { count: drawnCount(generation) })
            : format(locale, generation.reason === 'unclear' ? 'board.make.unclear' : 'board.make.nothing', {}),
          actionButton(
            {
              label: format(locale, 'board.make.dismiss', {}),
              style: secondaryAction(),
              onClick: Message.ClickedDismiss(),
            },
            h,
          ),
        ],
      ),
    Failed: () => h.empty,
  }),
)

/** A mood board or one picture: a radio group whose options are the two cards, each named by its title and described
 * by its hint. */
const kindsView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: model.kindChoice.id,
    model: model.kindChoice,
    view: KindRadioGroup.view,
    viewInputs: {
      options: kinds,
      selectedValue: Option.some(model.kind),
      ariaLabel: format(locale, 'board.make.kindLabel', {}),
      orientation: 'Horizontal',
      hasOptionDescription: () => true,
      toView: ({ group, options }) =>
        h.div(
          [...group, ...styled(h, styles.kinds())],
          options.map((option) =>
            h.button(
              [...option.option, ...styled(h, styles.kind())],
              [
                h.span(
                  [...option.label, ...styled(h, styles.kindTitle())],
                  [format(locale, kindKey[option.value].title, {})],
                ),
                h.span(
                  [...option.description, ...styled(h, styles.kindHint())],
                  [format(locale, kindKey[option.value].hint, {})],
                ),
              ],
            ),
          ),
        ),
    },
    toParentMessage: (message) => Message.GotKindChoiceMessage({ message }),
  })

const costId = 'board-make-cost'

const sheetBody = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const asking = Job.guards.Asking(model.job)
  return [
    kindsView(model, locale, h),
    h.form(
      [h.OnSubmit(Message.SubmittedMake()), h.AriaBusy(asking), ...styled(h, styles.form())],
      [
        h.label(
          [h.For('board-make-words'), ...styled(h, styles.label())],
          [format(locale, 'board.make.wordsLabel', {})],
        ),
        h.textarea([
          h.Id('board-make-words'),
          h.Name('words'),
          h.Attribute('rows', '3'),
          h.Attribute('maxlength', '280'),
          h.Placeholder(format(locale, 'board.make.wordsPlaceholder', {})),
          h.Value(model.words),
          h.OnInput((words) => Message.ChangedWords({ words })),
          ...styled(h, cx(textField(), textArea())),
        ]),
        h.p([h.Id(costId), ...styled(h, styles.note())], [costOf(model.kind, locale)]),
        h.p(styled(h, styles.note()), [format(locale, 'board.make.note', {})]),
        Job.guards.Failed(model.job)
          ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, problemKey[model.job.problem], {})])
          : h.empty,
        // aria-disabled rather than disabled, so the button keeps focus while its ask goes (DESIGN › Controls); the
        // form's submit is refused while there is nothing to send.
        actionButton(
          {
            label: format(locale, 'board.make.submit', {}),
            style: primaryAction(),
            type: 'submit',
            isDisabled: !canMake(model),
            leading: asking ? loader(h) : h.empty,
            describedBy: costId,
          },
          h,
        ),
      ],
    ),
  ]
}

/** Make with Styld: a mood board or one picture, from the person's words. */
export const sheetView = Submodel.defineView<Model, Message, Inputs>((model, { locale }, h) =>
  sheetShown(model.sheet)
    ? bottomSheet(
        {
          dialog: model.sheet,
          title: format(locale, 'board.make.title', {}),
          body: () => sheetBody(model, locale, h),
          toParentMessage: (message) => Message.GotSheetMessage({ message }),
          locale,
        },
        h,
      )
    : h.empty,
)
