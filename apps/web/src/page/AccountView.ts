import type { AccountClaims } from '@styld/auth/config'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction, secondaryAction } from '../Actions.styles.ts'
import { Message as AppMessage, type Model as AppModel, Session } from '../App.ts'
import { loader } from '../Icon.ts'
import { confirmActions } from '../Confirm.ts'
import { styled } from '../Styled.ts'
import { Copy, Deletion, Message, type Model } from './Account.ts'
import { avatar as personAvatar } from '../Avatar.ts'
import { checkNotice } from './CheckNotice.ts'
import {
  accountPage,
  avatarSkeleton,
  deleteAccount,
  emailSkeleton,
  hostName,
  identity,
  identityEmail,
  identityName,
  identityText,
  linkedSection,
  nameSkeleton,
  notice,
  problem,
  rowActions,
  section,
  sectionText,
  sectionTitle,
  serverUrl,
  statusSkeleton,
  steps,
  unavailable,
} from './AccountView.styles.ts'
import { pageHead, pageTitle } from './PageHead.ts'
import { assistantsSection, personRouter, profileRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'

type Inputs = {
  readonly claims: AccountClaims
  readonly signingOut: boolean
  readonly locale: Locale
  readonly origin: string
}

const assistants = (model: Model, { locale, origin }: Inputs, h: HtmlBuilder<Message>): Html => {
  const url = `${origin}/mcp`
  // Ask's stylist links here.
  return h.section(
    [h.Id(assistantsSection), ...styled(h, cx(section(), linkedSection()))],
    [
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
    ],
  )
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
        // Destructive and rare: a quiet text action in the error colour, not a pill as heavy as Sign out.
        actionButton(
          {
            label: format(locale, 'account.deleteAccount', {}),
            style: cx(linkAction(), deleteAccount()),
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

/** Who they are: the name and tone their profile shows others, in shape while it is read, so the sign-in name never
 * shows first and then changes; the sign-in name on stone if the profile has none or cannot be read. */
const identityView = (model: Model, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  if (AsyncData.isLoading(model.profile) || AsyncData.isIdle(model.profile))
    return h.div(styled(h, identity()), [
      h.span([h.AriaHidden(true), ...styled(h, cx(block(), avatarSkeleton()))]),
      h.div(styled(h, identityText()), [
        h.span([h.AriaHidden(true), ...styled(h, cx(line(), nameSkeleton()))]),
        h.span(styled(h, identityEmail()), [inputs.claims.email]),
      ]),
    ])
  const profile = AsyncData.getData(model.profile)
  const named = Option.filter(profile, ({ name }) => name.trim() !== '')
  return h.div(styled(h, identity()), [
    Option.match(named, {
      onNone: () => personAvatar(inputs.claims.displayName, 'stone', 'large', h),
      onSome: ({ name, tone }) => personAvatar(name, tone, 'large', h),
    }),
    h.div(styled(h, identityText()), [
      h.span(styled(h, identityName()), [
        Option.match(named, { onNone: () => inputs.claims.displayName, onSome: ({ name }) => name }),
      ]),
      h.span(styled(h, identityEmail()), [inputs.claims.email]),
    ]),
  ])
}

/** Where the public profile stands, in one quiet line, then the check's word on it and the ways to it. */
const profileSection = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(styled(h, section()), [
    h.h2(styled(h, sectionTitle()), [format(locale, 'profile.card.title', {})]),
    ...AsyncData.matchData(model.profile, {
      onEmpty: () => [h.span([h.AriaHidden(true), ...styled(h, cx(line(), statusSkeleton()))])],
      onFailure: () => [
        h.p([h.Role('alert'), ...styled(h, problem())], [format(locale, 'profile.card.loadFailed', {})]),
      ],
      onData: (profile) =>
        profile.handle === null
          ? [h.p(styled(h, sectionText()), [format(locale, 'profile.card.setUp', {})])]
          : [
              h.p(styled(h, sectionText()), [
                format(locale, profile.published ? 'profile.card.public' : 'profile.card.private', {
                  username: profile.handle,
                }),
              ]),
              ...(profile.published ? [checkNotice(profile.check, locale, h)] : []),
            ],
    }),
    h.div(styled(h, rowActions()), [
      AsyncData.isFailure(model.profile)
        ? actionButton(
            {
              label: format(locale, 'common.tryAgain', {}),
              style: linkAction(),
              onClick: Message.ClickedRetryProfile(),
            },
            h,
          )
        : h.empty,
      Option.match(
        Option.flatMap(AsyncData.getData(model.profile), (profile) =>
          profile.published ? Option.fromNullishOr(profile.handle) : Option.none(),
        ),
        {
          onNone: () => h.empty,
          onSome: (handle) =>
            h.a(
              [h.Href(personRouter({ handle })), ...styled(h, linkAction())],
              [format(locale, 'profile.card.viewPage', {})],
            ),
        },
      ),
      h.a([h.Href(profileRouter({})), ...styled(h, linkAction())], [format(locale, 'profile.editor.mode.edit', {})]),
    ]),
  ])

/** The signed-in person's account (Gallery `account.html`): who they are, connecting an assistant,
 * signing out and deleting the account. */
const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  h.section(
    [],
    [
      pageHead(pageTitle(format(inputs.locale, 'account.title', {}), h), Option.none(), h),
      identityView(model, inputs, h),
      profileSection(model, inputs.locale, h),
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

/** While the session is read: the page's head, and the shape of who they are. */
const checking = (locale: Locale, h: HtmlBuilder<AppMessage>): Html =>
  h.section(
    [],
    [
      pageHead(pageTitle(format(locale, 'account.title', {}), h), Option.none(), h),
      h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'common.loading', {})]),
      h.div(
        [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, identity())],
        [
          h.span(styled(h, cx(block(), avatarSkeleton()))),
          h.span(styled(h, identityText()), [
            h.span(styled(h, cx(line(), nameSkeleton()))),
            h.span(styled(h, cx(line(), emailSkeleton()))),
          ]),
        ],
      ),
    ],
  )

const signedIn = (
  model: AppModel,
  account: Model,
  claims: AccountClaims,
  signingOut: boolean,
  h: HtmlBuilder<AppMessage>,
): Html =>
  h.submodel({
    slotId: 'account',
    model: account,
    view,
    viewInputs: { claims, signingOut, locale: model.context.locale, origin: model.context.origin },
    toParentMessage: (message) => AppMessage.GotAccountMessage({ message }),
  })

/** The account page. A signed-out visitor is on the way to the sign-in page, so they see the same
 * loading line as while the session is read. */
export const accountView = (model: AppModel, account: Model, h: HtmlBuilder<AppMessage>): Html => {
  const { locale } = model.context
  return h.main(
    [h.Id('main'), ...styled(h, accountPage())],
    [
      Session.match(model.session, {
        Checking: () => checking(locale, h),
        SignedOut: () => checking(locale, h),
        SignedIn: ({ claims }) => signedIn(model, account, claims, false, h),
        SigningOut: ({ claims }) => signedIn(model, account, claims, true, h),
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
