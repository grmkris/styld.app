import type { AccountClaims } from '@styld/auth/config'
import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { Message, type Model, Session } from '../App.ts'
import { loader } from '../Icon.ts'
import { styled } from '../Styled.ts'
import {
  accountPage,
  avatar,
  identity,
  identityEmail,
  identityName,
  identityText,
  pendingStatus,
  unavailable,
} from './AccountView.styles.ts'

const checking = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p([h.Role('status'), ...styled(h, pendingStatus())], [loader(h), format(locale, 'common.loading', {})])

const signedIn = (claims: AccountClaims, signingOut: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [],
    [
      h.h1([], [format(locale, 'account.title', {})]),
      h.div(styled(h, identity()), [
        h.span([h.AriaHidden(true), ...styled(h, avatar())], [claims.displayName.slice(0, 1).toUpperCase()]),
        h.div(styled(h, identityText()), [
          h.span(styled(h, identityName()), [claims.displayName]),
          h.span(styled(h, identityEmail()), [claims.email]),
        ]),
      ]),
      actionButton(
        {
          label: format(locale, 'auth.signOut', {}),
          style: secondaryAction(),
          onClick: Message.RequestedSignOut(),
          isDisabled: signingOut,
          leading: signingOut ? loader(h) : h.empty,
        },
        h,
      ),
    ],
  )

/** The signed-in person's account (Gallery `account.html`). A signed-out visitor is on the way
 * to the sign-in page, so they see the same loading line as while the session is read. */
export const accountView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return h.main(
    [h.Id('main'), ...styled(h, accountPage())],
    [
      Session.match(model.session, {
        Checking: () => checking(locale, h),
        SignedOut: () => checking(locale, h),
        SignedIn: ({ claims }) => signedIn(claims, false, locale, h),
        SigningOut: ({ claims }) => signedIn(claims, true, locale, h),
        Unavailable: () =>
          h.section(styled(h, unavailable()), [
            h.p([h.Role('alert')], [format(locale, 'common.error', {})]),
            actionButton(
              {
                label: format(locale, 'common.retry', {}),
                style: primaryAction(),
                onClick: Message.RequestedSession(),
              },
              h,
            ),
          ]),
      }),
    ],
  )
}
