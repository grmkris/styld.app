import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { Option } from 'effect'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { checkIcon, loader, retryIcon } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { Camera, type Hint, HoldScreen, Message, type Model, screenId, ShowPhoto } from './HeldCamera.ts'
import * as styles from './HeldCameraView.styles.ts'

const hintKey: { readonly [Key in Hint]: MessageKey } = {
  holdOne: 'capture.camera.holdOne',
  checking: 'capture.camera.checking',
  counting: 'capture.camera.counting',
  blocked: 'capture.camera.blocked',
  taken: 'capture.camera.taken',
  showBack: 'capture.camera.showBack',
  notSeen: 'capture.camera.notSeen',
  tapToTake: 'capture.camera.tapToTake',
}

/** What the camera above pieces laid out says instead. */
const flatHintKey: { readonly [Key in Hint]?: MessageKey } = {
  holdOne: 'capture.camera.layOne',
  showBack: 'capture.camera.turnOver',
  notSeen: 'capture.camera.notLaid',
}

const statusText = (model: Model, locale: Locale) =>
  Camera.match(model.camera, {
    Starting: () => format(locale, 'capture.camera.starting', {}),
    Watching: ({ hint }) =>
      format(locale, (model.layout === 'flat' ? flatHintKey[hint] : undefined) ?? hintKey[hint], {}),
    Closed: () => '',
    Failed: () => '',
  })

const hintOf = (model: Model) => (Camera.guards.Watching(model.camera) ? model.camera.hint : 'starting')

/** How far the ring round the shutter has filled, in quarters: as the picture calms down, and all the
 * way while the check looks. */
const settleOf = (model: Model) => (hintOf(model) === 'checking' ? 4 : model.settle)

/** The front and back steps, the current one marked. */
const steps = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p(
    styled(h, styles.steps()),
    (['front', 'back'] as const).map((step) =>
      h.span(
        [...(model.step === step ? [h.AriaCurrent('step')] : []), ...styled(h, styles.step())],
        [format(locale, step === 'front' ? 'capture.camera.front' : 'capture.camera.back', {})],
      ),
    ),
  )

/** The round shutter, whose ring fills as the picture settles. The camera takes the photo on a press, as
 * on a tap on the picture. */
const shutter = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.DataAttribute('shutter', ''),
      h.AriaLabel(format(locale, 'capture.camera.shutter', {})),
      h.OnClick(Message.ClickedShutter()),
      ...styled(h, styles.shutter()),
    ],
    [
      h.svg(
        [h.ViewBox('0 0 80 80'), h.AriaHidden(true), ...styled(h, styles.ring())],
        [
          h.circle([...ringCircle(h), ...styled(h, styles.ringTrack())]),
          h.circle([
            ...ringCircle(h),
            h.DataAttribute('settle', String(settleOf(model))),
            ...styled(h, styles.ringFill()),
          ]),
        ],
      ),
      h.span(styled(h, styles.shutterDisc())),
    ],
  )

const countdown = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Option.match(model.countdown, {
    onNone: () => h.empty,
    onSome: (count) =>
      count <= 0
        ? h.empty
        : h.p(
            [h.Role('status'), h.AriaLive('assertive'), ...styled(h, styles.countdown())],
            [h.span(styled(h, styles.countdownNumber()), [format(locale, 'capture.camera.countdown', { count })])],
          ),
  })

const ringCircle = (h: HtmlBuilder<Message>) => [
  h.Attribute('cx', '40'),
  h.Attribute('cy', '40'),
  h.Attribute('r', '37'),
  h.Attribute('pathLength', '100'),
]

/** Finish, shown beside the stack of photos taken. */
const stack = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.button(
    [h.Type('button'), h.OnClick(Message.ClickedDone()), ...styled(h, cx(styles.press(), styles.stack()))],
    [
      h.span(styled(h, styles.stackFrame()), [
        Option.match(model.lastCheck, {
          onNone: () => checkIcon(h),
          onSome: (photo) =>
            h.keyed('img')(`shot-${model.shots}`, [
              h.Alt(''),
              h.OnMount(ShowPhoto({ photo })),
              ...styled(h, styles.stackPhoto()),
            ]),
        }),
      ]),
      h.span([], [format(locale, 'capture.camera.finishAction', {})]),
    ],
  )

/** The steps and the count, over the top of the picture. */
const top = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, cx(styles.bar(), styles.top())), [
    steps(model, locale, h),
    model.pieces === 0
      ? h.empty
      : h.button(
          [
            h.Type('button'),
            h.OnClick(Message.ClickedDone()),
            h.AriaLabel(format(locale, 'capture.camera.finish', { count: model.pieces })),
            ...styled(h, cx(styles.press(), styles.count())),
          ],
          [format(locale, 'capture.camera.count', { count: model.pieces }), checkIcon(h)],
        ),
  ])

/** What the camera is doing, the way past the back, and the controls, over the bottom of the picture. */
const bottom = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, cx(styles.bar(), styles.bottom())), [
    h.p(
      [h.Role('status'), h.AriaLive('polite'), h.DataAttribute('hint', hintOf(model)), ...styled(h, styles.status())],
      [
        Option.isSome(model.pendingCheck) || Camera.guards.Starting(model.camera) ? loader(h) : h.empty,
        statusText(model, locale),
      ],
    ),
    model.step === 'back'
      ? h.button(
          [h.Type('button'), h.OnClick(Message.ClickedSkipBack()), ...styled(h, cx(styles.press(), styles.skip()))],
          [format(locale, 'capture.camera.skipBack', {})],
        )
      : h.empty,
    h.div(styled(h, styles.controls()), [
      stack(model, locale, h),
      shutter(model, locale, h),
      h.button(
        [
          h.Type('button'),
          h.AriaLabel(format(locale, 'capture.camera.flip', {})),
          h.OnClick(Message.ClickedFlip()),
          ...styled(h, cx(styles.press(), styles.round())),
        ],
        [retryIcon(h)],
      ),
    ]),
  ])

/** The camera's own picture, edge to edge, with the frame to hold a piece in and the bars over it. A tap
 * on the picture takes a photo. Flipping the camera mounts a new one under a new key. */
const picture = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('div')(model.facing, styled(h, styles.stage()), [
    h.video([
      h.Attribute('playsinline', ''),
      h.Attribute('muted', ''),
      h.Attribute('autoplay', ''),
      h.DataAttribute('facing', model.facing),
      h.DataAttribute('shutter', ''),
      h.OnClick(Message.ClickedShutter()),
      h.AriaHidden(true),
      ...styled(h, styles.video()),
    ]),
    h.div([h.AriaHidden(true), h.DataAttribute('hint', hintOf(model)), ...styled(h, styles.guide())]),
    model.shots === 0
      ? h.empty
      : h.keyed('div')(`flash-${model.shots}`, [h.AriaHidden(true), ...styled(h, styles.flash())]),
    countdown(model, locale, h),
    top(model, locale, h),
    bottom(model, locale, h),
  ])

/** The camera screen: a modal dialog over the whole page while the camera starts and watches. */
const screen = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.dialog(
    [
      h.Id(screenId),
      h.Open(true),
      h.AriaModal(true),
      h.AriaLabel(format(locale, 'capture.camera.title', {})),
      h.OnCancelPreventDefault(Message.ClickedDone()),
      h.OnMount(HoldScreen()),
      ...styled(h, styles.screen()),
    ],
    [picture(model, locale, h)],
  )

/** The held-up camera, full screen over the add page while it watches; a message in the page when it
 * cannot start; nothing while it is closed. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  Camera.match(model.camera, {
    Closed: () => h.empty,
    Failed: ({ reason }) =>
      h.section(
        [h.Role('alert'), ...styled(h, styles.failed())],
        [
          h.p([], [format(locale, reason === 'denied' ? 'capture.camera.denied' : 'capture.camera.unavailable', {})]),
          actionButton(
            { label: format(locale, 'common.close', {}), style: secondaryAction(), onClick: Message.ClickedDone() },
            h,
          ),
        ],
      ),
    Starting: () => screen(model, locale, h),
    Watching: () => screen(model, locale, h),
  }),
)
