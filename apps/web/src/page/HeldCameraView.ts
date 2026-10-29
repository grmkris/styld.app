import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { loader } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { Camera, type Hint, Message, type Model, WatchCamera } from './HeldCamera.ts'
import * as styles from './HeldCameraView.styles.ts'

const hintKey: { readonly [Key in Hint]: MessageKey } = {
  holdOne: 'capture.camera.holdOne',
  checking: 'capture.camera.checking',
  taken: 'capture.camera.taken',
  tapToTake: 'capture.camera.tapToTake',
}

const statusText = (model: Model, locale: Locale) =>
  Camera.match(model.camera, {
    Starting: () => format(locale, 'capture.camera.starting', {}),
    Watching: ({ hint }) => format(locale, hintKey[hint], {}),
    Closed: () => '',
    Failed: () => '',
  })

const hintOf = (model: Model) => (Camera.guards.Watching(model.camera) ? model.camera.hint : 'starting')

/** The live picture. It is the shutter too: a tap or Enter takes a photo. Flipping the camera mounts a
 * new one under a new key. */
const picture = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('div')(
    model.facing,
    [
      h.Role('button'),
      h.Tabindex(0),
      h.AriaLabel(format(locale, 'capture.camera.shutter', {})),
      h.OnMount(WatchCamera({ facing: model.facing })),
      ...styled(h, styles.picture()),
    ],
    [
      h.video([
        h.Attribute('playsinline', ''),
        h.Attribute('muted', ''),
        h.Attribute('autoplay', ''),
        h.DataAttribute('facing', model.facing),
        h.AriaHidden(true),
        ...styled(h, styles.video()),
      ]),
      model.shots === 0
        ? h.empty
        : h.span(styled(h, styles.count()), [format(locale, 'capture.camera.count', { count: model.shots })]),
      h.p(
        [h.Role('status'), h.AriaLive('polite'), h.DataAttribute('hint', hintOf(model)), ...styled(h, styles.status())],
        [model.checking || Camera.guards.Starting(model.camera) ? loader(h) : h.empty, statusText(model, locale)],
      ),
    ],
  )

const panel = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabel(format(locale, 'capture.camera.title', {})), ...styled(h, styles.panel())],
    [
      picture(model, locale, h),
      h.div(styled(h, styles.controls()), [
        actionButton(
          {
            label: format(locale, 'capture.camera.flip', {}),
            style: secondaryAction(),
            onClick: Message.ClickedFlip(),
          },
          h,
        ),
        actionButton(
          {
            label: format(locale, 'capture.done', {}),
            style: cx(primaryAction(), styles.grow()),
            onClick: Message.ClickedDone(),
          },
          h,
        ),
      ]),
    ],
  )

/** The held-up camera, open on the add page; nothing while it is closed. */
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
    Starting: () => panel(model, locale, h),
    Watching: () => panel(model, locale, h),
  }),
)
