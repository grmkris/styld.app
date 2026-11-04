import { format, type Locale } from '@styld/i18n'
import type { Audience } from '@styld/protocol'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction } from '../Actions.styles.ts'
import { styled } from '../Styled.ts'
import { Answer, answerOnItsWay, asks, choices, Message, type Model, shownChoice } from './ShowMe.ts'
import * as styles from './ShowMeView.styles.ts'

const choiceKey = {
  women: 'showMe.women',
  men: 'showMe.men',
  all: 'showMe.all',
} as const satisfies Record<Audience, string>

/** The three choices, the chosen one pressed; none takes a press while an answer is on its way. The Account page
 * presses the order in force (Everything until one is chosen); Home's card asks, so it presses only the answer on its
 * way, never a default the person did not pick. */
export const choiceButtons = (
  model: Model,
  { labelledBy, pressesDefault }: { readonly labelledBy: string; readonly pressesDefault: boolean },
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  const chosen = pressesDefault ? shownChoice(model) : answerOnItsWay(model)
  return h.div(
    [h.Role('group'), h.AriaLabelledBy(labelledBy), ...styled(h, styles.choices())],
    choices.map((showMe) =>
      actionButton(
        {
          label: format(locale, choiceKey[showMe], {}),
          style: cx(styles.chip(), styles.chosen()),
          pressed: Option.contains(chosen, showMe),
          isDisabled: Answer.guards.Saving(model.answer),
          onClick: Message.ClickedChoice({ showMe }),
        },
        h,
      ),
    ),
  )
}

/** That the choice did not save, while it is the last word. */
export const failure = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Answer.guards.Failed(model.answer)
    ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'showMe.failed', {})])
    : h.empty

/** Home's card, above What's new, until the person answers or puts it away; drawn from the first paint unless this
 * browser saw an answer, so its arrival never moves Home. */
export const card = Submodel.defineView<Model, Message, { readonly locale: Locale; readonly answeredHere: boolean }>(
  (model, { locale, answeredHere }, h) =>
    asks(model, answeredHere)
      ? h.section(
          [h.AriaLabelledBy('show-me-title'), ...styled(h, styles.card())],
          [
            h.h2([h.Id('show-me-title'), ...styled(h, styles.title())], [format(locale, 'showMe.title', {})]),
            h.p(styled(h, styles.reason()), [format(locale, 'showMe.reason', {})]),
            h.div(styled(h, styles.choices()), [
              choiceButtons(model, { labelledBy: 'show-me-title', pressesDefault: false }, locale, h),
              actionButton(
                {
                  label: format(locale, 'showMe.notNow', {}),
                  style: linkAction(),
                  isDisabled: Answer.guards.Saving(model.answer),
                  onClick: Message.ClickedNotNow(),
                },
                h,
              ),
            ]),
            failure(model, locale, h),
          ],
        )
      : h.empty,
)
