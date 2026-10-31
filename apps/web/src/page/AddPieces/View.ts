import { Button, FileDrop } from '@foldkit/ui'
import { ImageType, VideoType } from '@styld/protocol'
import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Option } from 'effect'
import { File, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../../ActionButton.ts'
import { primaryAction, secondaryAction } from '../../Actions.styles.ts'
import { textField } from '../../Fields.styles.ts'
import { cameraIcon, linkIcon, loader, photoIcon, retryIcon, videoIcon } from '../../Icon.ts'
import { styled } from '../../Styled.ts'
import { type LinkProblem, Message, type SendProblem } from './Message.ts'
import { type FileProblem, type Item, type LinkItem, LinkSending, type Model, Sending } from './Model.ts'
import { backToWardrobe } from '../PageBar.ts'
import * as HeldCamera from '../HeldCamera.ts'
import * as HeldCameraView from '../HeldCameraView.ts'
import * as styles from './View.styles.ts'

const fileProblemKey: { readonly [Problem in FileProblem]: MessageKey } = {
  notSupported: 'capture.notSupported',
  tooLarge: 'capture.tooLarge',
}

const sendProblemKey: { readonly [Problem in SendProblem]: MessageKey } = {
  dailyLimit: 'capture.problem.dailyLimit',
  videoTooLong: 'capture.problem.videoTooLong',
  videoUnreadable: 'capture.problem.videoUnreadable',
  refused: 'capture.problem.refused',
  network: 'capture.problem.network',
}

const linkProblemKey: { readonly [Problem in LinkProblem]: MessageKey } = {
  notHttps: 'capture.linkProblem.notHttps',
  notReached: 'capture.linkProblem.notReached',
  blocked: 'capture.linkProblem.blocked',
  notAPage: 'capture.linkProblem.notAPage',
  noPicture: 'capture.linkProblem.noPicture',
  slowDown: 'capture.linkProblem.slowDown',
  dailyLimit: 'capture.problem.dailyLimit',
  refused: 'capture.problem.refused',
  network: 'capture.problem.network',
}

/** A page out of reach or too many at once may go on another try; a shop's refusal answers the same way twice. */
const retryableLink: ReadonlySet<LinkProblem> = new Set(['network', 'dailyLimit', 'slowDown', 'notReached'])

/** Problems that trying again can fix: an unreadable video reads the same way twice. A video the day's
 * allowance stopped resumes at its next part tomorrow. */
const retryable: ReadonlySet<SendProblem> = new Set(['network', 'dailyLimit'])

const pickerTypes: ReadonlyArray<string> = [...ImageType.literals, ...VideoType.literals]

const library = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: model.drop.id,
    model: model.drop,
    view: FileDrop.view,
    viewInputs: {
      accept: pickerTypes,
      multiple: true,
      toView: (attributes) =>
        h.label(
          [...attributes.root, ...styled(h, styles.source())],
          [
            h.span(styled(h, styles.sourceIcons()), [photoIcon(h), videoIcon(h)]),
            h.span(styled(h, styles.sourceTitle()), [format(locale, 'capture.chooseTitle', {})]),
            h.span(styled(h, styles.sourceHint()), [format(locale, 'capture.chooseHint', {})]),
            h.input(attributes.input),
          ],
        ),
    },
    toParentMessage: (message) => Message.GotDropMessage({ message }),
  })

/** The camera on this page: hold each garment up, or lay each one out under it, and it takes the photo. */
const cameraSource = (
  way: { readonly onClick: Message; readonly title: MessageKey; readonly hint: MessageKey },
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  Button.view(
    {
      onClick: way.onClick,
      toView: (attributes) =>
        h.button(
          [...attributes.button, ...styled(h, styles.source())],
          [
            h.span(styled(h, styles.sourceIcons()), [cameraIcon(h)]),
            h.span(styled(h, styles.sourceTitle()), [format(locale, way.title, {})]),
            h.span(styled(h, styles.sourceHint()), [format(locale, way.hint, {})]),
          ],
        ),
    },
    h,
  )

/** The two ways that work best, before the ways in: pieces laid out, or each one held up. */
const guidance = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('scan-ways'), ...styled(h, styles.guidance())],
    [
      h.h2([h.Id('scan-ways'), ...styled(h, styles.guidanceTitle())], [format(locale, 'capture.scan.title', {})]),
      h.ul(styled(h, styles.guidanceList()), [
        h.li(
          [],
          [
            h.strong([], [format(locale, 'capture.scan.layTitle', {})]),
            ' ',
            format(locale, 'capture.scan.layHint', {}),
          ],
        ),
        h.li(
          [],
          [
            h.strong([], [format(locale, 'capture.scan.holdTitle', {})]),
            ' ',
            format(locale, 'capture.scan.holdHint', {}),
          ],
        ),
      ]),
    ],
  )

/** Add from a link: a shop's product page, whose picture Styld reads and sends to the tray. */
const linkSource = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.Id('link'), h.OnSubmit(Message.SubmittedLink()), ...styled(h, styles.linkForm())],
    [
      h.label([h.For('link-address'), ...styled(h, styles.sourceTitle())], [format(locale, 'capture.linkTitle', {})]),
      h.p([h.Id('link-hint'), ...styled(h, styles.linkHint())], [format(locale, 'capture.linkHint', {})]),
      h.div(styled(h, styles.linkRow()), [
        h.input([
          h.Id('link-address'),
          h.Name('url'),
          h.Type('url'),
          h.InputMode('url'),
          h.Autocomplete('off'),
          h.AriaDescribedBy('link-hint'),
          h.Placeholder(format(locale, 'capture.linkPlaceholder', {})),
          h.Value(model.link),
          h.OnInput((url) => Message.ChangedLink({ url })),
          ...styled(h, textField()),
        ]),
        h.button(
          [h.Type('submit'), ...styled(h, secondaryAction())],
          [linkIcon(h), format(locale, 'capture.linkAdd', {})],
        ),
      ]),
    ],
  )

const heldCamera = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'held-camera',
    model: model.held,
    view: HeldCameraView.view,
    viewInputs: { locale },
    toParentMessage: (message) => Message.GotHeldCameraMessage({ message }),
  })

/** The ways in, or the open camera in their place. */
const sources = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  HeldCamera.isOpen(model.held)
    ? [heldCamera(model, locale, h)]
    : [
        guidance(locale, h),
        h.div(styled(h, styles.sources()), [
          library(model, locale, h),
          cameraSource(
            { onClick: Message.ClickedLayOut(), title: 'capture.layOutTitle', hint: 'capture.layOutHint' },
            locale,
            h,
          ),
          cameraSource(
            { onClick: Message.ClickedHoldUp(), title: 'capture.holdUpTitle', hint: 'capture.holdUpHint' },
            locale,
            h,
          ),
        ]),
        linkSource(model, locale, h),
      ]

/** What a file on its way is doing: a photo uploading, a video being read, or the part of it on its way. */
const sendingText = (item: Item, locale: Locale) => {
  if (item.kind === 'photo') return format(locale, 'wardrobe.uploadingImage', {})
  return Option.match(
    Option.filter(item.plan, ({ route }) => route === 'parts'),
    {
      onNone: () => format(locale, 'capture.preparingVideo', {}),
      onSome: ({ parts }) => format(locale, 'capture.readingPart', { part: item.partsSent + 1, parts: parts.length }),
    },
  )
}

/** Why a file stopped. A video the day's allowance stopped partway says how much of it went. */
const failedText = (item: Item, problem: SendProblem, locale: Locale) =>
  problem === 'dailyLimit' && item.partsSent > 0
    ? format(locale, 'capture.problem.videoPartial', {
        sent: item.partsSent,
        parts: Option.match(item.plan, { onNone: () => item.partsSent, onSome: ({ parts }) => parts.length }),
      })
    : format(locale, sendProblemKey[problem], {})

const itemState = (item: Item, index: number, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Sending.match(item.sending, {
    Waiting: () => h.span(styled(h, styles.queueDone()), [format(locale, 'capture.waiting', {})]),
    Sending: () => h.span(styled(h, styles.queueState()), [loader(h), sendingText(item, locale)]),
    Sent: () => h.span(styled(h, styles.queueDone()), [format(locale, 'capture.sent', {})]),
    Failed: ({ problem }) =>
      h.span(styled(h, styles.queueState()), [
        h.span(styled(h, styles.queueFailed()), [failedText(item, problem, locale)]),
        retryable.has(problem)
          ? Button.view(
              {
                onClick: Message.ClickedRetry({ index }),
                toView: (attributes) =>
                  h.button(
                    [
                      ...attributes.button,
                      h.AriaLabel(format(locale, 'capture.retryFile', { name: File.name(item.file) })),
                      ...styled(h, styles.retry()),
                    ],
                    [retryIcon(h)],
                  ),
              },
              h,
            )
          : h.empty,
      ]),
  })

/** A product page's row: the name the page gave, or its address without the scheme and the query. */
const linkName = (link: LinkItem) =>
  Option.getOrElse(link.name, () => link.url.replace(/^https?:\/\//u, '').split(/[?#]/u)[0] ?? link.url)

const linkState = (link: LinkItem, index: number, locale: Locale, h: HtmlBuilder<Message>): Html =>
  LinkSending.match(link.sending, {
    Sending: () => h.span(styled(h, styles.queueState()), [loader(h), format(locale, 'capture.readingLink', {})]),
    Sent: () => h.span(styled(h, styles.queueDone()), [format(locale, 'capture.sent', {})]),
    Failed: ({ problem }) =>
      h.span(styled(h, styles.queueState()), [
        h.span(styled(h, styles.queueFailed()), [format(locale, linkProblemKey[problem], {})]),
        retryableLink.has(problem)
          ? h.button(
              [
                h.Type('button'),
                h.OnClick(Message.ClickedRetryLink({ index })),
                h.AriaLabel(format(locale, 'capture.retryFile', { name: linkName(link) })),
                ...styled(h, styles.retry()),
              ],
              [retryIcon(h)],
            )
          : h.empty,
      ]),
  })

const queue = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  model.items.length + model.links.length === 0
    ? h.empty
    : h.ul(
        [h.AriaLabel(format(locale, 'capture.queueLabel', {})), ...styled(h, styles.queue())],
        [
          ...model.items.map((item, index) =>
            h.keyed('li')(item.key, styled(h, styles.queueRow()), [
              h.span(styled(h, styles.queueIcon()), [item.kind === 'video' ? videoIcon(h) : photoIcon(h)]),
              h.span(styled(h, styles.queueName()), [File.name(item.file)]),
              itemState(item, index, locale, h),
            ]),
          ),
          ...model.links.map((link, index) =>
            h.keyed('li')(link.key, styled(h, styles.queueRow()), [
              h.span(styled(h, styles.queueIcon()), [linkIcon(h)]),
              h.span(styled(h, styles.queueName()), [linkName(link)]),
              linkState(link, index, locale, h),
            ]),
          ),
        ],
      )

const sentCount = (model: Model) =>
  model.items.filter(({ sending }) => Sending.guards.Sent(sending)).length +
  model.links.filter(({ sending }) => LinkSending.guards.Sent(sending)).length
const failedCount = (model: Model) =>
  model.items.filter(({ sending }) => Sending.guards.Failed(sending)).length +
  model.links.filter(({ sending }) => LinkSending.guards.Failed(sending)).length
const pending = (model: Model) =>
  model.items.some(({ sending }) => Sending.guards.Waiting(sending) || Sending.guards.Sending(sending)) ||
  model.links.some(({ sending }) => LinkSending.guards.Sending(sending))

/** One summary of the queue, always present, so assistive technology hears each change. */
const summary = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Role('status'), h.AriaLive('polite'), ...styled(h, styles.summary())],
    model.items.length + model.links.length === 0
      ? []
      : [
          format(locale, 'capture.queueSummary', {
            sent: sentCount(model),
            total: model.items.length + model.links.length,
            failed: failedCount(model),
          }),
        ],
  )

/** Add pieces: photos or a video from the library, or photos from the camera. Each goes up as it is
 * chosen; the review tray shows what was found. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.addPage())],
    [
      h.div(styled(h, styles.pageBar()), [backToWardrobe(locale, h)]),
      h.h1([], [format(locale, 'capture.addTitle', {})]),
      h.p(styled(h, styles.lede()), [format(locale, 'capture.addHint', {})]),
      ...sources(model, locale, h),
      model.rejected.length === 0
        ? h.empty
        : h.ul(
            [h.Role('alert'), ...styled(h, styles.problems())],
            model.rejected.map(({ name, problem }) => h.li([], [format(locale, fileProblemKey[problem], { name })])),
          ),
      summary(model, locale, h),
      queue(model, locale, h),
      // Offered once nothing is waiting or on its way: leaving the page would cut an upload short.
      sentCount(model) === 0 || pending(model)
        ? h.empty
        : actionButton(
            {
              label: format(locale, 'capture.seeFound', { count: sentCount(model) }),
              style: cx(primaryAction(), styles.review()),
              onClick: Message.ClickedReview(),
            },
            h,
          ),
    ],
  ),
)
