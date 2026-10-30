import { Button, FileDrop } from '@foldkit/ui'
import { ImageType, VideoType } from '@styld/protocol'
import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Option } from 'effect'
import { File, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../../ActionButton.ts'
import { primaryAction } from '../../Actions.styles.ts'
import { cameraIcon, loader, photoIcon, retryIcon, videoIcon } from '../../Icon.ts'
import { styled } from '../../Styled.ts'
import { Message, type SendProblem } from './Message.ts'
import { type FileProblem, type Item, type Model, Sending } from './Model.ts'
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

/** The camera on this page: hold each garment up and it takes the photo. */
const holdUp = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  Button.view(
    {
      onClick: Message.ClickedHoldUp(),
      toView: (attributes) =>
        h.button(
          [...attributes.button, ...styled(h, styles.source())],
          [
            h.span(styled(h, styles.sourceIcons()), [cameraIcon(h)]),
            h.span(styled(h, styles.sourceTitle()), [format(locale, 'capture.holdUpTitle', {})]),
            h.span(styled(h, styles.sourceHint()), [format(locale, 'capture.holdUpHint', {})]),
          ],
        ),
    },
    h,
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
    : [h.div(styled(h, styles.sources()), [library(model, locale, h), holdUp(locale, h)])]

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

const queue = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  model.items.length === 0
    ? h.empty
    : h.ul(
        [h.AriaLabel(format(locale, 'capture.queueLabel', {})), ...styled(h, styles.queue())],
        model.items.map((item, index) =>
          h.keyed('li')(item.key, styled(h, styles.queueRow()), [
            h.span(styled(h, styles.queueIcon()), [item.kind === 'video' ? videoIcon(h) : photoIcon(h)]),
            h.span(styled(h, styles.queueName()), [File.name(item.file)]),
            itemState(item, index, locale, h),
          ]),
        ),
      )

const sentCount = (model: Model) => model.items.filter(({ sending }) => Sending.guards.Sent(sending)).length
const failedCount = (model: Model) => model.items.filter(({ sending }) => Sending.guards.Failed(sending)).length
const pending = (model: Model) =>
  model.items.some(({ sending }) => Sending.guards.Waiting(sending) || Sending.guards.Sending(sending))

/** One summary of the queue, always present, so assistive technology hears each change. */
const summary = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Role('status'), h.AriaLive('polite'), ...styled(h, styles.summary())],
    model.items.length === 0
      ? []
      : [
          format(locale, 'capture.queueSummary', {
            sent: sentCount(model),
            total: model.items.length,
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
