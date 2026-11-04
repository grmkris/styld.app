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
import { Arrival, Checkout, Copy, Deletion, Message, type Model } from './Account.ts'
import { premiumWeek, type CreditBalance } from '@styld/protocol'
import { intlLocale } from '../Locale.ts'
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
  signOutRow,
  statusSkeleton,
  steps,
  unavailable,
} from './AccountView.styles.ts'
import { pageHead, pageTitle } from './PageHead.ts'
import { tasteSection } from './TasteView.ts'
import { Message as ShowMeMessage, type Model as ShowMeModel } from './ShowMe.ts'
import { choiceButtons, failure as showMeFailure } from './ShowMeView.ts'
import { assistantsSection, creditsSection, personRouter, profileRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'

type Inputs = {
  readonly claims: AccountClaims
  readonly signingOut: boolean
  readonly locale: Locale
  readonly origin: string
  readonly timeZone: string
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

/** The day premium ends, in the person's language and time zone. */
const premiumEnd = (until: string, { locale, timeZone }: Inputs) =>
  new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long', timeZone }).format(new Date(until))

/** After a payment: received, and the week on its way from Dodo's webhook. */
const paidNotice = (model: Model, credits: CreditBalance, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Arrival.match(model.arrival, {
    Plain: () => h.empty,
    Paid: ({ readsLeft }) =>
      credits.premiumUntil === null
        ? h.p(
            [h.Role('status'), ...styled(h, notice())],
            [format(locale, readsLeft > 0 ? 'account.credits.paid' : 'account.credits.paidSlow', {})],
          )
        : h.empty,
  })

/** The premium week's button, where the stage sells it: one payment through Dodo's page. */
const premiumOffer = (model: Model, credits: CreditBalance, locale: Locale, h: HtmlBuilder<Message>): Html[] => {
  if (!credits.premiumAvailable) return []
  const opening = Checkout.guards.Opening(model.checkout)
  return [
    h.p(styled(h, sectionText()), [
      format(locale, 'account.credits.premiumAbout', { daily: premiumWeek.dailyCredits, days: premiumWeek.days }),
    ]),
    h.div(styled(h, rowActions()), [
      actionButton(
        {
          label: format(locale, 'account.credits.premiumWeek', { price: premiumWeek.price }),
          style: primaryAction(),
          onClick: Message.ClickedPremiumWeek(),
          isDisabled: opening,
          leading: opening ? loader(h) : h.empty,
        },
        h,
      ),
    ]),
    Checkout.guards.Failed(model.checkout)
      ? h.p([h.Role('alert'), ...styled(h, problem())], [format(locale, 'account.credits.checkoutFailed', {})])
      : h.empty,
  ]
}

/** Today's credits, premium's end while it lasts, and the premium week to buy. */
const creditsView = (model: Model, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  return h.section(
    [h.Id(creditsSection), ...styled(h, cx(section(), linkedSection()))],
    [
      h.h2(styled(h, sectionTitle()), [format(locale, 'account.credits.title', {})]),
      ...AsyncData.matchData(model.credits, {
        onEmpty: () => [h.span([h.AriaHidden(true), ...styled(h, cx(line(), statusSkeleton()))])],
        onFailure: () => [
          h.p([h.Role('alert'), ...styled(h, problem())], [format(locale, 'account.credits.loadFailed', {})]),
          h.div(styled(h, rowActions()), [
            actionButton(
              {
                label: format(locale, 'common.tryAgain', {}),
                style: linkAction(),
                onClick: Message.ClickedRetryCredits(),
              },
              h,
            ),
          ]),
        ],
        onData: (credits) => [
          h.p(styled(h, sectionText()), [
            format(locale, 'account.credits.today', { remaining: credits.remaining, daily: credits.daily }),
          ]),
          credits.premiumUntil === null
            ? h.empty
            : h.p(styled(h, hostName()), [
                format(locale, 'account.credits.premiumUntil', { date: premiumEnd(credits.premiumUntil, inputs) }),
              ]),
          paidNotice(model, credits, locale, h),
          ...premiumOffer(model, credits, locale, h),
        ],
      }),
    ],
  )
}

/** What What's new starts with: the three choices Home's card asks once, the saved one pressed. */
const showMeSection = Submodel.defineView<ShowMeModel, ShowMeMessage, { readonly locale: Locale }>(
  (model, { locale }, h) =>
    h.section(
      [h.AriaLabelledBy('show-me-setting'), ...styled(h, section())],
      [
        h.h2([h.Id('show-me-setting'), ...styled(h, sectionTitle())], [format(locale, 'showMe.title', {})]),
        h.p(styled(h, sectionText()), [format(locale, 'showMe.accountReason', {})]),
        // The choices stand from the first paint, none pressed until the saved one is read, so nothing below moves.
        ...(AsyncData.isFailure(model.preferences)
          ? [
              h.p([h.Role('alert'), ...styled(h, problem())], [format(locale, 'common.error', {})]),
              h.div(styled(h, rowActions()), [
                actionButton(
                  {
                    label: format(locale, 'common.tryAgain', {}),
                    style: linkAction(),
                    onClick: ShowMeMessage.ClickedRetry(),
                  },
                  h,
                ),
              ]),
            ]
          : [
              choiceButtons(model, { labelledBy: 'show-me-setting', pressesDefault: true }, locale, h),
              showMeFailure(model, locale, h),
            ]),
      ],
    ),
)

/** Signing out, under who they are: on a phone it is in the first screen, never below the assistants' setup (browser
 * review, 2 November 2026). */
const signOut = ({ locale, signingOut }: Inputs, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, cx(rowActions(), signOutRow())), [
    actionButton(
      {
        label: format(locale, 'auth.signOut', {}),
        style: secondaryAction(),
        onClick: Message.ClickedSignOut(),
        isDisabled: signingOut,
        leading: signingOut ? loader(h) : h.empty,
      },
      h,
    ),
  ])

/** The signed-in person's account (Gallery `account.html`): who they are and signing out, their profile, connecting
 * an assistant, and deleting the account. */
const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  h.section(
    [],
    [
      pageHead(pageTitle(format(inputs.locale, 'account.title', {}), h), Option.none(), h),
      identityView(model, inputs, h),
      signOut(inputs, h),
      profileSection(model, inputs.locale, h),
      creditsView(model, inputs, h),
      h.submodel({
        slotId: 'account-show-me',
        model: model.showMe,
        view: showMeSection,
        viewInputs: { locale: inputs.locale },
        toParentMessage: (message) => Message.GotShowMeMessage({ message }),
      }),
      h.submodel({
        slotId: 'account-taste',
        model: model.taste,
        view: tasteSection,
        viewInputs: { locale: inputs.locale },
        toParentMessage: (message) => Message.GotTasteMessage({ message }),
      }),
      assistants(model, inputs, h),
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
    viewInputs: {
      claims,
      signingOut,
      locale: model.context.locale,
      origin: model.context.origin,
      timeZone: model.context.timeZone,
    },
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
