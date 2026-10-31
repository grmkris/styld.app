import { format, type Locale } from '@styld/i18n'
import { ReportReason } from '@styld/protocol'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { textField } from '../Fields.styles.ts'
import { loader, moreIcon, saveIcon } from '../Icon.ts'
import { boardRouter, lookRouter, personRouter, publicPieceRouter, signInReturningTo } from '../route.ts'
import { block } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { Message, type Model, Reporting, Standing, Subject, Work } from './People.ts'
import * as styles from './PeopleView.styles.ts'
import { barEnd, round } from './PageBar.styles.ts'
import { bottomSheet, sheetShown } from './Sheet.ts'
import { cx } from 'zyzz'

const button = (label: string, onClick: Message, h: HtmlBuilder<Message>): Html =>
  actionButton({ label, style: secondaryAction(), onClick }, h)

/** A switch-like action, following or saved: pressed while it holds, its loader in it while the change is sent, so
 * nothing below it moves (as Explore's Follow). */
const toggle = (label: string, pressed: boolean, busy: boolean, onClick: Message, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaPressed(String(pressed)),
      h.AriaBusy(busy),
      ...(busy ? [] : [h.OnClick(onClick)]),
      ...styled(h, pressed ? secondaryAction() : primaryAction()),
    ],
    [busy ? loader(h) : h.empty, label],
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

/** Save something someone else made public, and report it. Save is a round (DESIGN.md › Boards, people and Explore),
 * pressed while saved. */
const saveAndReport = (model: Model, report: string, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.button(
    [
      h.Type('button'),
      h.AriaLabel(format(locale, 'feed.save', {})),
      h.AriaPressed(String(model.saved)),
      h.OnClick(Message.ClickedSave({ saved: !model.saved })),
      ...styled(h, styles.save()),
    ],
    [saveIcon(h)],
  ),
  button(report, Message.ClickedReport(), h),
]

/** Follow's shape while where the visitor stands is read, holding the head so the tabs below stay put. */
const actionSkeleton = (h: HtmlBuilder<Message>): Html =>
  h.span([h.AriaHidden(true), ...styled(h, cx(block(), styles.actionSkeleton()))])

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

const subjectActions = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Subject.match(model.subject, {
    // On a profile, Follow is `followView` and Report and Block are behind More (`moreView`).
    Person: () => [],
    Piece: () => [...saveAndReport(model, format(locale, 'safety.report.piece', {}), locale, h)],
    Board: () => saveAndReport(model, format(locale, 'safety.report.board', {}), locale, h),
    Look: () => saveAndReport(model, format(locale, 'safety.report.look', {}), locale, h),
  })

/** The page the visitor is on, where sign-in brings them back. */
const pageOf = (subject: Subject) =>
  Subject.match(subject, {
    Person: ({ handle }) => personRouter({ handle }),
    Piece: ({ pieceId }) => publicPieceRouter({ pieceId }),
    Board: ({ boardId }) => boardRouter({ boardId }),
    Look: ({ lookId }) => lookRouter({ lookId }),
  })

/** Following and saving need an account. Signed out, Follow and Save look as they do signed in and lead to sign-in,
 * which returns to this page; their names say so. */
const signInAction = (
  model: Model,
  name: string,
  style: Styles.Attributes,
  content: Html | string,
  h: HtmlBuilder<Message>,
  arrival = '',
) =>
  h.a(
    [h.Href(signInReturningTo(`${pageOf(model.subject)}${arrival}`)), h.AriaLabel(name), ...styled(h, style)],
    [content],
  )

/** What a visitor page passes in: its locale, and whether someone is signed in. */
export type Inputs = { readonly locale: Locale; readonly signedIn: boolean }

/** Follow on a profile, once it is known how the visitor stands with the person; signed out, the way to sign in to
 * follow. A blocked person is not followed. */
export const followView = Submodel.defineView<Model, Message, Inputs>((model, { locale, signedIn }, h) =>
  signedIn
    ? Standing.match(model.standing, {
        Unknown: () => h.empty,
        Reading: () => actionSkeleton(h),
        Known: ({ relation }) =>
          relation.blocked
            ? h.empty
            : toggle(
                format(locale, relation.following ? 'follow.following' : 'follow.follow', {}),
                relation.following,
                Work.guards.Sending(model.work),
                Message.ClickedFollow({ following: !relation.following }),
                h,
              ),
      })
    : // Back from sign-in at #follow, the profile follows them (People › FollowArrival).
      signInAction(
        model,
        format(locale, 'people.signInToFollow', {}),
        primaryAction(),
        format(locale, 'follow.follow', {}),
        h,
        '#follow',
      ),
)

/** Signed out, a profile's Follow is `followView`; a piece, look or board offers its round Save. */
const signedOutActions = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Subject.guards.Person(model.subject)
    ? []
    : [signInAction(model, format(locale, 'people.signInToSave', {}), styles.save(), saveIcon(h), h)]

/** What the visitor can do here: save, block or report, and how it went. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, { locale, signedIn }, h) =>
  h.div(styled(h, styles.people()), [
    h.div(
      styled(h, styles.actions()),
      signedIn ? subjectActions(model, locale, h) : signedOutActions(model, locale, h),
    ),
    // A profile's work shows in Follow itself.
    Work.guards.Sending(model.work) && !Subject.guards.Person(model.subject)
      ? h.p([h.Role('status')], [loader(h)])
      : h.empty,
    Work.guards.Failed(model.work)
      ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'people.actionFailed', {})])
      : h.empty,
    model.confirmingBlock && Subject.guards.Person(model.subject)
      ? blockConfirm(model.subject.handle, locale, h)
      : h.empty,
    reportForm(model, locale, h),
  ]),
)

/** Report and Block on someone's profile, behind More at the end of its bar (Gallery's person screen): a round that
 * opens a sheet of the two, once it is known how the visitor stands with the person. */
export const moreView = Submodel.defineView<Model, Message, Inputs>((model, { locale, signedIn }, h) => {
  if (!signedIn || !Subject.guards.Person(model.subject) || !Standing.guards.Known(model.standing)) return h.empty
  const { handle } = model.subject
  const { blocked } = model.standing.relation
  return h.div(styled(h, styles.more()), [
    h.button(
      [
        h.Type('button'),
        h.AriaLabel(format(locale, 'safety.more', {})),
        h.AriaHasPopup('dialog'),
        h.OnClick(Message.ClickedMore()),
        ...styled(h, cx(round(), barEnd())),
      ],
      [moreIcon(h)],
    ),
    sheetShown(model.more)
      ? bottomSheet(
          {
            dialog: model.more,
            title: `@${handle}`,
            body: (info) => [
              h.button(
                [
                  h.Type('button'),
                  ...info.initialFocus,
                  h.OnClick(Message.ClickedReport()),
                  ...styled(h, styles.moreOption()),
                ],
                [format(locale, 'safety.report.profile', {})],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.OnClick(blocked ? Message.ClickedConfirmBlock({ blocked: false }) : Message.ClickedBlock()),
                  ...styled(h, styles.moreOption()),
                ],
                [format(locale, blocked ? 'safety.block.unblock' : 'safety.block.block', { username: handle })],
              ),
            ],
            toParentMessage: (message) => Message.GotMoreMessage({ message }),
            locale,
          },
          h,
        )
      : h.empty,
  ])
})
