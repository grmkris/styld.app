import { format, type Locale } from '@styld/i18n'
import { ReportReason } from '@styld/protocol'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { textField } from '../Fields.styles.ts'
import { loader } from '../Icon.ts'
import { loginRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { Message, type Model, Reporting, Standing, Subject, Work } from './People.ts'
import * as styles from './PeopleView.styles.ts'

const button = (label: string, onClick: Message, h: HtmlBuilder<Message>): Html =>
  actionButton({ label, style: secondaryAction(), onClick }, h)

/** A switch-like action, following or saved: pressed while it holds. */
const toggle = (label: string, pressed: boolean, onClick: Message, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaPressed(String(pressed)),
      h.OnClick(onClick),
      ...styled(h, pressed ? secondaryAction() : primaryAction()),
    ],
    [label],
  )

const reasonLabel = (reason: ReportReason, locale: Locale) =>
  format(locale, `safety.reportDialog.reasons.${reason}`, {})

/** The report form: a reason from v1's list, the reporter's own words, and Send. */
const reportForm = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Reporting.match(model.reporting, {
    Closed: () => h.empty,
    Sending: () => h.p([h.Role('status')], [loader(h), format(locale, 'safety.reportDialog.sending', {})]),
    Sent: () => h.p([h.Role('status')], [format(locale, 'safety.reportDialog.sent', {})]),
    Failed: ({ tooMany }) =>
      h.p(
        [h.Role('alert'), ...styled(h, styles.problem())],
        [format(locale, tooMany ? 'safety.reportDialog.tooMany' : 'safety.reportDialog.failed', {})],
      ),
    Open: ({ reason, note }) =>
      h.form(
        [h.OnSubmit(Message.SubmittedReport()), ...styled(h, styles.report())],
        [
          h.p(styled(h, styles.note()), [format(locale, 'safety.reportDialog.description', {})]),
          h.fieldset(styled(h, styles.reasons()), [
            h.legend([], [format(locale, 'safety.reportDialog.reasonLegend', {})]),
            ...ReportReason.literals.map((each) =>
              h.label(
                [h.For(`report-reason-${each}`), ...styled(h, styles.reason())],
                [
                  h.input([
                    h.Id(`report-reason-${each}`),
                    h.Type('radio'),
                    h.Name('report-reason'),
                    h.Checked(Option.getOrNull(reason) === each),
                    h.OnChange(() => Message.ChoseReportReason({ reason: each })),
                  ]),
                  reasonLabel(each, locale),
                ],
              ),
            ),
          ]),
          h.label(
            [h.For('report-note'), ...styled(h, styles.field())],
            [
              format(locale, 'safety.reportDialog.noteLabel', {}),
              h.textarea([
                h.Id('report-note'),
                h.Value(note),
                h.Attribute('maxlength', '500'),
                h.Placeholder(format(locale, 'safety.reportDialog.notePlaceholder', {})),
                h.OnInput((value) => Message.UpdatedReportNote({ value })),
                ...styled(h, textField()),
              ]),
            ],
          ),
          h.div(styled(h, styles.actions()), [
            actionButton(
              {
                label: format(locale, 'safety.reportDialog.send', {}),
                style: primaryAction(),
                type: 'submit',
                isDisabled: Option.isNone(reason),
              },
              h,
            ),
            button(format(locale, 'safety.reportDialog.cancel', {}), Message.ClickedCancelReport(), h),
          ]),
        ],
      ),
  })

/** Follow and block a person, or ask to sign in first. */
const personActions = (model: Model, handle: string, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Standing.match(model.standing, {
    Unknown: () => [
      h.a([h.Href(loginRouter({})), ...styled(h, styles.signIn())], [format(locale, 'people.signInToFollow', {})]),
    ],
    Known: ({ relation }) => [
      relation.blocked
        ? h.empty
        : toggle(
            format(locale, relation.following ? 'follow.following' : 'follow.follow', {}),
            relation.following,
            Message.ClickedFollow({ following: !relation.following }),
            h,
          ),
      button(format(locale, 'safety.report.profile', {}), Message.ClickedReport(), h),
      relation.blocked
        ? button(
            format(locale, 'safety.block.unblock', { username: handle }),
            Message.ClickedConfirmBlock({ blocked: false }),
            h,
          )
        : button(format(locale, 'safety.block.block', { username: handle }), Message.ClickedBlock(), h),
    ],
  })

const blockConfirm = (handle: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Role('group'),
      h.AriaLabel(format(locale, 'safety.block.confirmTitle', { username: handle })),
      ...styled(h, styles.report()),
    ],
    [
      h.p([], [format(locale, 'safety.block.confirmBody', {})]),
      h.div(styled(h, styles.actions()), [
        actionButton(
          {
            label: format(locale, 'safety.block.confirm', {}),
            style: primaryAction(),
            onClick: Message.ClickedConfirmBlock({ blocked: true }),
          },
          h,
        ),
        button(format(locale, 'safety.block.cancel', {}), Message.ClickedKeepUnblocked(), h),
      ]),
    ],
  )

/** What the visitor can do here: follow, save, block or report. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.div(styled(h, styles.people()), [
    h.div(
      styled(h, styles.actions()),
      Subject.match(model.subject, {
        Person: ({ handle }) => personActions(model, handle, locale, h),
        Piece: () => [
          toggle(
            format(locale, model.saved ? 'people.saved' : 'feed.save', {}),
            model.saved,
            Message.ClickedSave({ saved: !model.saved }),
            h,
          ),
          button(format(locale, 'safety.report.piece', {}), Message.ClickedReport(), h),
        ],
      }),
    ),
    Work.guards.Sending(model.work) ? h.p([h.Role('status')], [loader(h)]) : h.empty,
    Work.guards.Failed(model.work)
      ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'people.actionFailed', {})])
      : h.empty,
    model.confirmingBlock && Subject.guards.Person(model.subject)
      ? blockConfirm(model.subject.handle, locale, h)
      : h.empty,
    reportForm(model, locale, h),
  ]),
)
