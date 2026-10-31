import { Button } from '@foldkit/ui'
import type { Detection, TrayCapture } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { fieldLabel, formError, textField } from '../Fields.styles.ts'
import { backIcon, checkIcon, editIcon, loader } from '../Icon.ts'
import { intlLocale } from '../Locale.ts'
import { addPiecesRouter } from '../route.ts'
import { block } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { piecePickers } from './PieceFields.ts'
import { type Decision, keptOf, Message, type Model, Saving, Tray } from './Review.ts'
import { kindName } from './WardrobeWords.ts'
import { backToWardrobe } from './PageBar.ts'
import { barStart, round } from './PageBar.styles.ts'
import { message as messageSection, messageTitle } from './WardrobeView.styles.ts'
import * as styles from './ReviewView.styles.ts'

/** A found piece's picture; the API Worker serves it to its owner only. */
const picturePath = (detection: Detection, decision: Decision | undefined) =>
  `/cdn/detections/${detection.id}/${decision?.useOriginal === true || !detection.hasCutout ? 'original' : 'cutout'}`

/** What a found piece is called: the person's name for it, else what one of its kind is called ("Skirt"), else a
 * prompt to say. */
const label = (decision: Decision | undefined, locale: Locale) => {
  const name = decision?.name.trim() ?? ''
  if (name.length > 0) return name
  return Option.match(decision?.category ?? Option.none(), {
    onNone: () => format(locale, 'wardrobe.addPieceCategoryPlaceholder', {}),
    onSome: (category) =>
      format(locale, kindName({ category, subcategory: Option.getOrNull(decision?.subcategory ?? Option.none()) }), {}),
  })
}

/** What the tile says under a piece's name, when there is more to say: the wardrobe may have it, or it needs a
 * better look. */
const note = (detection: Detection) => {
  if (detection.alreadyHave !== undefined) return Option.some('capture.alreadyHave' as const)
  return detection.partial === true ? Option.some('capture.betterLook' as const) : Option.none()
}

const foundTile = (detection: Detection, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const decision = model.decisions[detection.id]
  const kept = decision?.keep === true
  const name = label(decision, locale)
  return h.keyed('li')(
    detection.id,
    [],
    [
      h.figure(styled(h, styles.found()), [
        h.img([
          h.Src(picturePath(detection, decision)),
          h.Alt(name),
          h.Loading('lazy'),
          ...(kept ? [] : [h.DataAttribute('dropped', '')]),
          ...styled(h, styles.foundImage()),
        ]),
        Button.view(
          {
            onClick: Message.ToggledKeep({ detectionId: detection.id }),
            toView: (attributes) =>
              h.button(
                [
                  ...attributes.button,
                  h.AriaPressed(String(kept)),
                  h.AriaLabel(format(locale, 'capture.keepLabel', { name })),
                  ...styled(h, styles.tick()),
                ],
                [checkIcon(h)],
              ),
          },
          h,
        ),
        h.figcaption(styled(h, styles.caption()), [
          h.span(styled(h, styles.captionText()), [
            h.span(styled(h, styles.captionName()), [name]),
            Option.match(note(detection), {
              onNone: () => h.empty,
              onSome: (key) => h.span(styled(h, styles.captionKind()), [format(locale, key, {})]),
            }),
          ]),
          Button.view(
            {
              onClick: Message.ClickedEdit({ detectionId: detection.id }),
              toView: (attributes) =>
                h.button(
                  [
                    ...attributes.button,
                    h.AriaLabel(format(locale, 'scan.editItemLabel', { category: name })),
                    ...styled(h, styles.edit()),
                  ],
                  [editIcon(h)],
                ),
            },
            h,
          ),
        ]),
      ]),
    ],
  )
}

const pendingTile = (capture: TrayCapture, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    capture.id,
    [],
    [
      h.div(
        [h.Role('status'), ...styled(h, styles.pending())],
        [h.span(styled(h, styles.pendingLabel()), [loader(h), format(locale, 'capture.finding', {})])],
      ),
    ],
  )

/** What the page knows besides the tray: the language, and the person's time zone for the times it shows. */
type Inputs = { readonly locale: Locale; readonly timeZone: string }

/** When a capture was added, as the time of day in the person's time zone ("14:05"). */
const addedAt = (capture: TrayCapture, { locale, timeZone }: Inputs) =>
  new Intl.DateTimeFormat(intlLocale(locale), { hour: 'numeric', minute: '2-digit', timeZone }).format(
    new Date(capture.createdAt),
  )

/** A capture that waits for the person: it failed, stopped halfway, or found nothing. */
const notice = (capture: TrayCapture, model: Model, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const busy = model.acting.includes(capture.id)
  const canRetry = capture.status === 'failed' || capture.status === 'unknown'
  // Each says which capture it is (a failed one by when it was added); a video part with nothing whole in it was most
  // likely filmed too close.
  const { source } = capture
  const text =
    capture.status === 'unknown'
      ? format(locale, 'capture.unknown', { source })
      : capture.status === 'failed'
        ? format(locale, 'capture.failed', { source, time: addedAt(capture, inputs) })
        : source === 'video'
          ? format(locale, 'capture.emptyVideo', {})
          : format(locale, 'capture.empty', { source })
  return h.keyed('div')(capture.id, styled(h, styles.notice()), [
    h.p([], [text]),
    model.actionFailed.includes(capture.id)
      ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'capture.actionFailed', {})])
      : h.empty,
    h.div(styled(h, styles.noticeActions()), [
      canRetry
        ? actionButton(
            {
              label: format(locale, 'common.tryAgain', {}),
              style: secondaryAction(),
              isDisabled: busy,
              onClick: Message.ClickedRetryCapture({ captureId: capture.id }),
            },
            h,
          )
        : h.empty,
      actionButton(
        {
          label: format(locale, 'capture.remove', {}),
          style: secondaryAction(),
          isDisabled: busy,
          onClick: Message.ClickedRemoveCapture({ captureId: capture.id }),
        },
        h,
      ),
    ]),
  ])
}

/** How often what the person added showed the piece, and a way to undo it when they were different pieces. */
const sightings = (detection: Detection, locale: Locale, h: HtmlBuilder<Message>): Html =>
  detection.sightings > 1
    ? h.div(styled(h, styles.sightings()), [
        h.p([], [format(locale, 'capture.sightings', { count: detection.sightings })]),
        actionButton(
          {
            label: format(locale, 'capture.split', {}),
            style: secondaryAction(),
            onClick: Message.ClickedSplit({ detectionId: detection.id }),
          },
          h,
        ),
      ])
    : h.empty

/** The wardrobe's piece the garment was taken for, beside the way to keep both. */
const alreadyHave = (detection: Detection, locale: Locale, h: HtmlBuilder<Message>): Html =>
  detection.alreadyHave === undefined
    ? h.empty
    : h.div(styled(h, styles.alreadyHave()), [
        h.img([
          h.Src(`/cdn/pieces/${detection.alreadyHave}/thumb`),
          h.Alt(format(locale, 'capture.alreadyHaveImage', {})),
          h.Loading('lazy'),
          ...styled(h, styles.alreadyHaveImage()),
        ]),
        h.p([], [format(locale, 'capture.alreadyHaveHint', {})]),
      ])

/** The open piece: its picture, the original photo instead, what it is and its name. */
const editor = (detection: Detection, decision: Decision, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabel(label(decision, locale)), ...styled(h, styles.editor())],
    [
      h.h1([], [label(decision, locale)]),
      h.img([
        h.Src(picturePath(detection, decision)),
        h.Alt(label(decision, locale)),
        ...styled(h, styles.editorImage()),
      ]),
      alreadyHave(detection, locale, h),
      detection.partial === true
        ? h.p(styled(h, styles.sightings()), [format(locale, 'capture.betterLookHint', {})])
        : h.empty,
      sightings(detection, locale, h),
      detection.hasCutout
        ? h.label(styled(h, styles.original()), [
            h.input([
              h.Type('checkbox'),
              h.Checked(decision.useOriginal),
              h.OnChange(() => Message.ToggledUseOriginal()),
            ]),
            format(locale, 'capture.useOriginal', {}),
          ])
        : h.empty,
      ...piecePickers(
        {
          category: decision.category,
          categoryMissing: false,
          subcategory: decision.subcategory,
          colours: decision.colours,
          coloursLegend: 'wardrobe.addPieceColorsLabel',
          messages: Message,
        },
        locale,
        h,
      ),
      h.label([h.For('found-name'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.nameOptionalLabel', {})]),
      h.input([
        h.Id('found-name'),
        h.Type('text'),
        h.Maxlength(80),
        h.Autocomplete('off'),
        h.Value(decision.name),
        h.OnInput((value) => Message.UpdatedName({ value })),
        ...styled(h, textField()),
      ]),
    ],
  )

const footer = (model: Model, locale: Locale, h: HtmlBuilder<Message>, editing: boolean): Html => {
  const count = keptOf(model).length
  const busy = Saving.guards.Preparing(model.saving) || Saving.guards.Saving(model.saving)
  return h.div(styled(h, styles.footer()), [
    h.div(styled(h, styles.footerInner()), [
      Saving.guards.Failed(model.saving)
        ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'capture.addFailed', {})])
        : h.empty,
      editing
        ? actionButton(
            {
              label: format(locale, 'capture.done', {}),
              style: cx(primaryAction(), styles.wide()),
              onClick: Message.ClickedDoneEditing(),
            },
            h,
          )
        : actionButton(
            {
              label: format(locale, busy ? 'wardrobe.addingPieces' : 'capture.addCount', { count }),
              style: cx(primaryAction(), styles.wide()),
              isDisabled: busy || count === 0,
              leading: busy ? loader(h) : h.empty,
              onClick: Message.ClickedAdd(),
            },
            h,
          ),
    ]),
  ])
}

const trayView = (captures: ReadonlyArray<TrayCapture>, model: Model, inputs: Inputs, h: HtmlBuilder<Message>) => {
  const { locale } = inputs
  const found = captures.flatMap(({ detections }) => detections)
  const waiting = captures.filter(({ status }) => status === 'processing')
  const needing = captures.filter(
    ({ status, detections }) =>
      status === 'failed' || status === 'unknown' || (status === 'review' && detections.length === 0),
  )
  if (captures.length === 0)
    return [
      h.section(styled(h, messageSection()), [
        h.h2(styled(h, messageTitle()), [format(locale, 'scan.listEmpty', {})]),
        h.a([h.Href(addPiecesRouter({})), ...styled(h, primaryAction())], [format(locale, 'capture.addTitle', {})]),
      ]),
    ]
  // What went wrong comes first, where it is seen, not under every piece found.
  return [
    ...needing.map((capture) => notice(capture, model, inputs, h)),
    h.ul(styled(h, styles.grid()), [
      ...waiting.map((capture) => pendingTile(capture, locale, h)),
      ...found.map((detection) => foundTile(detection, model, locale, h)),
    ]),
    found.length > 0 ? footer(model, locale, h, false) : h.empty,
  ]
}

const openPiece = (model: Model) =>
  Option.flatMap(model.editing, (id) => {
    const detection = Tray.guards.Loaded(model.tray)
      ? model.tray.tray.captures.flatMap(({ detections }) => detections).find((each) => each.id === id)
      : undefined
    const decision = model.decisions[id]
    return detection === undefined || decision === undefined ? Option.none() : Option.some({ detection, decision })
  })

const header = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  if (!Tray.guards.Loaded(model.tray)) return [h.h1([], [format(locale, 'scan.toReview', {})])]
  const { captures, allowance } = model.tray.tray
  const count = captures.reduce((sum, { detections }) => sum + detections.length, 0)
  return [
    h.h1([], [format(locale, 'capture.foundTitle', { count })]),
    count > 0 ? h.p(styled(h, styles.lede()), [format(locale, 'capture.reviewHint', {})]) : h.empty,
    h.p(styled(h, styles.allowance()), [format(locale, 'capture.allowance', allowance)]),
    model.stale
      ? h.p([h.Role('status'), ...styled(h, styles.allowance())], [format(locale, 'capture.stale', {})])
      : h.empty,
  ]
}

/** The review tray: what was found in the person's photos and videos, ticked to keep. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) => {
  const { locale } = inputs
  const open = openPiece(model)
  return h.main(
    [h.Id('main'), ...styled(h, styles.reviewPage())],
    [
      h.div(styled(h, styles.pageBar()), [
        Option.isSome(open)
          ? Button.view(
              {
                onClick: Message.ClickedDoneEditing(),
                toView: (attributes) =>
                  h.button(
                    [
                      ...attributes.button,
                      h.AriaLabel(format(locale, 'common.back', {})),
                      ...styled(h, cx(round(), barStart())),
                    ],
                    [backIcon(h)],
                  ),
              },
              h,
            )
          : backToWardrobe(locale, h),
        h.a([h.Href(addPiecesRouter({})), ...styled(h, styles.addMore())], [format(locale, 'capture.addMore', {})]),
      ]),
      ...Option.match(open, {
        onSome: ({ detection, decision }) => [editor(detection, decision, locale, h), footer(model, locale, h, true)],
        onNone: () => [
          ...header(model, locale, h),
          ...Tray.match(model.tray, {
            Loading: () => [
              h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'common.loading', {})]),
              h.ul(
                [h.AriaHidden(true), ...styled(h, styles.grid())],
                ['a', 'b', 'c', 'd'].map((slot) =>
                  h.keyed('li')(slot, [], [h.span(styled(h, cx(block(), styles.foundSkeleton())))]),
                ),
              ),
            ],
            Failed: () => [
              h.section(
                [h.Role('alert'), ...styled(h, messageSection())],
                [
                  h.h2(styled(h, messageTitle()), [format(locale, 'scan.listError', {})]),
                  actionButton(
                    {
                      label: format(locale, 'common.tryAgain', {}),
                      style: secondaryAction(),
                      onClick: Message.ClickedRetryLoad(),
                    },
                    h,
                  ),
                ],
              ),
            ],
            Loaded: ({ tray }) => trayView(tray.captures, model, inputs, h),
          }),
        ],
      }),
    ],
  )
})
