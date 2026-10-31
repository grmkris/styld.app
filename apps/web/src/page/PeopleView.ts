import { format, type Locale } from '@styld/i18n'
import { ReportReason } from '@styld/protocol'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { textField } from '../Fields.styles.ts'
import { loader, saveIcon } from '../Icon.ts'
import {
  boardRouter,
  lookRouter,
  personRouter,
  publicPieceRouter,
  signInReturningTo,
  wishlistRouter,
} from '../route.ts'
import { block } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { Message, type Model, Reporting, Standing, Subject, Work } from './People.ts'
import * as styles from './PeopleView.styles.ts'
import { cx } from 'zyzz'

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

/** An action's shape while where the visitor stands is read: Follow, Report and Block arrive together, and their
 * shapes hold the head so the tabs below stay put. */
const actionSkeleton = (h: HtmlBuilder<Message>): Html =>
  h.span([h.AriaHidden(true), ...styled(h, cx(block(), styles.actionSkeleton()))])

/** Report and block a person, once it is known how the visitor stands with them (never on one's own profile); Follow
 * is `followView`, which the profile puts first. */
const personActions = (model: Model, handle: string, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Standing.match(model.standing, {
    Unknown: () => [],
    Reading: () => [actionSkeleton(h), actionSkeleton(h)],
    Known: ({ relation }) => [
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

const subjectActions = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Subject.match(model.subject, {
    Person: ({ handle }) => personActions(model, handle, locale, h),
    Piece: () => [
      model.wished
        ? h.a(
            [h.Href(wishlistRouter({})), ...styled(h, secondaryAction())],
            [format(locale, 'catalog.savedToWishlist', {})],
          )
        : button(format(locale, 'catalog.saveToWishlist', {}), Message.ClickedWish(), h),
      ...saveAndReport(model, format(locale, 'safety.report.piece', {}), locale, h),
    ],
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
                Message.ClickedFollow({ following: !relation.following }),
                h,
              ),
      })
    : // Back from sign-in at #follow, the profile follows them (People › followOnArrival).
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
