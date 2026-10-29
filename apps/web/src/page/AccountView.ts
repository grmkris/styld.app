import type { AccountClaims } from '@styld/auth/config'
import { format, type Locale } from '@styld/i18n'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { Message as AppMessage, type Model as AppModel, Session } from '../App.ts'
import { loader } from '../Icon.ts'
import { confirmActions } from '../ConfirmActions.ts'
import { styled } from '../Styled.ts'
import { Copy, Deletion, Message, type Model } from './Account.ts'
import {
  accountPage,
  avatar,
  hostName,
  identity,
  identityEmail,
  identityName,
  identityText,
  notice,
  pendingStatus,
  problem,
  rowActions,
  section,
  sectionText,
  sectionTitle,
  serverUrl,
  steps,
  unavailable,
} from './AccountView.styles.ts'

type Inputs = {
  readonly claims: AccountClaims
  readonly signingOut: boolean
  readonly locale: Locale
  readonly origin: string
}

const assistants = (model: Model, { locale, origin }: Inputs, h: HtmlBuilder<Message>): Html => {
  const url = `${origin}/mcp`
  return h.section(styled(h, section()), [
    h.h2(styled(h, sectionTitle()), [format(locale, 'account.assistants.title', {})]),
    h.p(styled(h, sectionText()), [format(locale, 'account.assistants.description', {})]),
    h.p(styled(h, hostName()), ['Claude']),
    h.ol(styled(h, steps()), [
      h.li([], [format(locale, 'connect.claude.first', {})]),
      h.li([], [format(locale, 'connect.claude.second', {})]),
    ]),
    h.p(styled(h, hostName()), ['ChatGPT']),
    h.ol(styled(h, steps()), [
      h.li([], [format(locale, 'connect.chatgpt.first', {})]),
      h.li([], [format(locale, 'connect.chatgpt.second', {})]),
    ]),
    h.code([h.Id('server-url'), ...styled(h, serverUrl())], [url]),
    h.div(styled(h, rowActions()), [
      actionButton(
        {
          label: format(locale, 'connect.copy', {}),
          style: secondaryAction(),
          onClick: Message.ClickedCopyServerUrl({ url }),
        },
        h,
      ),
      Copy.match(model.copy, {
        Idle: () => h.empty,
        Copied: () => h.p([h.Role('status'), ...styled(h, notice())], [format(locale, 'connect.copied', {})]),
        Failed: () => h.p([h.Role('alert'), ...styled(h, problem())], [format(locale, 'connect.copyFailed', {})]),
      }),
    ]),
  ])
}

const deletion = (model: Model, { locale }: Inputs, h: HtmlBuilder<Message>): Html => {
  const deleting = Deletion.guards.Deleting(model.deletion)
  const confirmation = h.div(
    styled(h, rowActions()),
    confirmActions(
      {
        confirm: format(locale, 'account.deleteAccountConfirm', {}),
        cancel: format(locale, 'common.cancel', {}),
        onConfirm: Message.ClickedConfirmDelete(),
        onCancel: Message.ClickedKeepAccount(),
        busy: deleting,
      },
      h,
    ),
  )
  return h.section(styled(h, section()), [
    ...Deletion.match(model.deletion, {
      Idle: () => [
        actionButton(
          {
            label: format(locale, 'account.deleteAccount', {}),
            style: secondaryAction(),
            onClick: Message.ClickedDeleteAccount(),
          },
          h,
        ),
      ],
      Confirming: () => [
        h.h2(styled(h, sectionTitle()), [format(locale, 'account.deleteAccountConfirmTitle', {})]),
        h.p(styled(h, sectionText()), [format(locale, 'account.deleteAccountConfirmBody', {})]),
        confirmation,
      ],
      Deleting: () => [
        h.h2(styled(h, sectionTitle()), [format(locale, 'account.deleteAccountConfirmTitle', {})]),
        h.p(styled(h, sectionText()), [format(locale, 'account.deleteAccountConfirmBody', {})]),
        confirmation,
      ],
      Failed: () => [
        h.h2(styled(h, sectionTitle()), [format(locale, 'account.deleteAccountConfirmTitle', {})]),
        h.p([h.Role('alert'), ...styled(h, problem())], [format(locale, 'account.deleteAccountFailed', {})]),
        confirmation,
      ],
    }),
  ])
}

/** The signed-in person's account (Gallery `account.html`): who they are, connecting an assistant,
 * signing out and deleting the account. */
const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  h.section(
    [],
    [
      h.h1([], [format(inputs.locale, 'account.title', {})]),
      h.div(styled(h, identity()), [
        h.span([h.AriaHidden(true), ...styled(h, avatar())], [inputs.claims.displayName.slice(0, 1).toUpperCase()]),
        h.div(styled(h, identityText()), [
          h.span(styled(h, identityName()), [inputs.claims.displayName]),
          h.span(styled(h, identityEmail()), [inputs.claims.email]),
        ]),
      ]),
      assistants(model, inputs, h),
      h.section(styled(h, section()), [
        actionButton(
          {
            label: format(inputs.locale, 'auth.signOut', {}),
            style: secondaryAction(),
            onClick: Message.ClickedSignOut(),
            isDisabled: inputs.signingOut,
            leading: inputs.signingOut ? loader(h) : h.empty,
          },
          h,
        ),
      ]),
      deletion(model, inputs, h),
    ],
  ),
)

const checking = (locale: Locale, h: HtmlBuilder<AppMessage>): Html =>
  h.p([h.Role('status'), ...styled(h, pendingStatus())], [loader(h), format(locale, 'common.loading', {})])

const signedIn = (model: AppModel, claims: AccountClaims, signingOut: boolean, h: HtmlBuilder<AppMessage>): Html =>
  h.submodel({
    slotId: 'account',
    model: model.account,
    view,
    viewInputs: { claims, signingOut, locale: model.context.locale, origin: model.context.origin },
    toParentMessage: (message) => AppMessage.GotAccountMessage({ message }),
  })

/** The account page. A signed-out visitor is on the way to the sign-in page, so they see the same
 * loading line as while the session is read. */
export const accountView = (model: AppModel, h: HtmlBuilder<AppMessage>): Html => {
  const { locale } = model.context
  return h.main(
    [h.Id('main'), ...styled(h, accountPage())],
    [
      Session.match(model.session, {
        Checking: () => checking(locale, h),
        SignedOut: () => checking(locale, h),
        SignedIn: ({ claims }) => signedIn(model, claims, false, h),
        SigningOut: ({ claims }) => signedIn(model, claims, true, h),
        Unavailable: () =>
          h.section(styled(h, unavailable()), [
            h.p([h.Role('alert')], [format(locale, 'common.error', {})]),
            actionButton(
              {
                label: format(locale, 'common.retry', {}),
                style: primaryAction(),
                onClick: AppMessage.RequestedSession(),
              },
              h,
            ),
          ]),
      }),
    ],
  )
}
