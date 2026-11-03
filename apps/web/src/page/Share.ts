import { format, type Locale } from '@styld/i18n'
import { Effect, Option, Schema } from 'effect'
import { Command, Submodel, Update } from 'foldkit'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction, smallAction } from '../Actions.styles.ts'
import { shareIcon } from '../Icon.ts'
import { barEnd, round } from './PageBar.styles.ts'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { styled } from '../Styled.ts'
import * as styles from './Share.styles.ts'

// Share a page of this site (a profile, a public piece, a board): the browser's share sheet where it has one for the
// link, else the link copied. One submodel for every page that shares, kept as `sharing` in the page's model.

// MODEL

/** Nothing to say (or the browser's share sheet said it), the link copied where there is no share sheet, or the copy
 * refused. */
export const Model = defineTaggedUnion({ Idle: {}, Copied: {}, Failed: {} })
export type Model = typeof Model.Type

export const init: Model = Model.Idle()

// MESSAGE

export const Message = defineMessageUnion({
  /** Share the page at `path` (this site's), titled `title`. */
  ClickedShare: { path: Schema.String, title: Schema.String },
  SucceededShareLink: { copied: Schema.Boolean },
  FailedShareLink: {},
})
export type Message = typeof Message.Type

// COMMAND

/** Closing the share sheet without sharing is the person's choice, not a failure. */
const shareRefusal = (error: unknown): 'dismissed' | 'refused' =>
  error instanceof DOMException && error.name === 'AbortError' ? 'dismissed' : 'refused'

/** The browser's share sheet where it has one for the link, else the link copied to the clipboard; a share sheet that
 * fails for any reason but being closed copies instead. The link is this site's own: `path` on the page's origin. */
export const ShareLink = Command.define('ShareLink', {
  args: { path: Schema.String, title: Schema.String },
  messages: [Message.SucceededShareLink, Message.FailedShareLink],
  execute: ({ path, title }) =>
    Effect.suspend(() => {
      const url = new URL(path, location.origin).href
      const copy = Effect.tryPromise(() => navigator.clipboard.writeText(url)).pipe(
        Effect.as(Message.SucceededShareLink({ copied: true })),
      )
      const share = Effect.tryPromise({ try: () => navigator.share({ url, title }), catch: shareRefusal }).pipe(
        Effect.as(Message.SucceededShareLink({ copied: false })),
        Effect.catch((refusal) =>
          refusal === 'dismissed' ? Effect.succeed(Message.SucceededShareLink({ copied: false })) : copy,
        ),
      )
      const canShare = 'share' in navigator && 'canShare' in navigator && navigator.canShare({ url, title })
      return canShare ? share : copy
    }).pipe(Effect.orElseSucceed(() => Message.FailedShareLink())),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedShare: ({ path, title }) => ({ model: Model.Idle(), commands: [ShareLink({ path, title })] }),
    SucceededShareLink: ({ copied }) => ({ model: copied ? Model.Copied() : Model.Idle() }),
    FailedShareLink: () => ({ model: Model.Failed() }),
  })

/** Sharing inside a page whose model keeps it as `sharing`. */
export const foldInto = <Parent extends { readonly sharing: Model }, ParentMessage>(
  toParentMessage: (message: Message) => ParentMessage,
) =>
  Update.foldChild({
    update,
    read: (parent: Parent) => Option.some(parent.sharing),
    write: (parent: Parent, sharing: Model): Parent => ({ ...parent, sharing }),
    toParentMessage,
  })

// VIEW

/** What Share shares, and how its button looks: a labelled action (a profile), a small one (a board's bar) or the
 * round at the end of a head bar (a piece). */
export type Inputs = {
  readonly locale: Locale
  readonly path: string
  readonly title: string
  readonly look: 'action' | 'small' | 'round'
}

/** The Share button; its page embeds it with `h.submodel`. */
export const buttonView = Submodel.defineView<Model, Message, Inputs>((_sharing, { locale, path, title, look }, h) => {
  const label = format(locale, 'share.button', {})
  const onClick = Message.ClickedShare({ path, title })
  return look === 'round'
    ? h.button(
        [h.Type('button'), h.AriaLabel(label), ...styled(h, cx(round(), barEnd())), h.OnClick(onClick)],
        [shareIcon(h)],
      )
    : actionButton(
        {
          label,
          style: look === 'small' ? cx(secondaryAction(), smallAction()) : secondaryAction(),
          leading: shareIcon(h),
          onClick,
        },
        h,
      )
})

/** What Share did, where the browser had no share sheet to say it. */
export const statusView = <ParentMessage>(sharing: Model, locale: Locale, h: HtmlBuilder<ParentMessage>): Html =>
  Model.match(sharing, {
    Idle: () => h.empty,
    Copied: () => h.p([h.Role('status'), ...styled(h, styles.shared())], [format(locale, 'share.linkCopied', {})]),
    Failed: () => h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'share.copyFailed', {})]),
  })
