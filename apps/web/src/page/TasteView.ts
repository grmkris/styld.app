import { format, type Locale } from '@styld/i18n'
import { type Learned, Occasion, type StyleNote } from '@styld/protocol'
import { Array, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction } from '../Actions.styles.ts'
import { intlLocale } from '../Locale.ts'
import { styled } from '../Styled.ts'
import { rowActions, section, sectionText, sectionTitle } from './AccountView.styles.ts'
import { Choosing, Message, type Model, Removal, shownOccasions } from './Taste.ts'
import * as styles from './TasteView.styles.ts'
import { colourName, occasionName, typeName } from './WardrobeWords.ts'

/** A list in the reader's language: "navy, blue and grey". */
const listOf = (items: ReadonlyArray<string>, locale: Locale) =>
  new Intl.ListFormat(intlLocale(locale), { type: 'conjunction' }).format(items)

/** The occasions as chips, pressed when chosen; none takes a press while a change saves. */
const occasions = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const chosen = shownOccasions(model)
  return h.div(
    [h.Role('group'), h.AriaLabelledBy('taste-occasions'), ...styled(h, styles.chips())],
    Occasion.literals.map((occasion) =>
      actionButton(
        {
          label: format(locale, occasionName(occasion), {}),
          style: cx(styles.chip(), styles.chosen()),
          pressed: chosen.includes(occasion),
          isDisabled: Choosing.guards.Saving(model.choosing),
          onClick: Message.ClickedOccasion({ occasion }),
        },
        h,
      ),
    ),
  )
}

/** One note, and Remove; a note that could not be removed says so. */
const noteLine = (model: Model, note: StyleNote, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.li(styled(h, styles.noteRow()), [
    h.span([h.Id(`taste-${note.id}`)], [note.text]),
    actionButton(
      {
        label: format(locale, 'taste.remove', {}),
        describedBy: `taste-${note.id}`,
        style: linkAction(),
        isDisabled: Removal.guards.Removing(model.removal),
        onClick: Message.ClickedRemoveNote({ noteId: note.id }),
      },
      h,
    ),
    Removal.guards.Failed(model.removal) && model.removal.noteId === note.id
      ? h.span([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'taste.failed', {})])
      : h.empty,
  ])

/** What Styld learned, a line for each kind it knows; nothing yet says so. */
const learnedLines = (learned: Learned, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const named = (keys: ReadonlyArray<Parameters<typeof format>[1]>) => keys.map((key) => format(locale, key, {}))
  const lines = [
    learned.colours.length === 0
      ? null
      : format(locale, 'taste.colours', { list: listOf(named(learned.colours.map(colourName)), locale) }),
    learned.wornTypes.length === 0
      ? null
      : format(locale, 'taste.kinds', { list: listOf(named(learned.wornTypes.map(typeName)), locale) }),
    learned.aesthetics.length === 0
      ? null
      : format(locale, 'taste.aesthetics', {
          list: listOf(
            learned.aesthetics.map((slug) => slug.replaceAll('-', ' ')),
            locale,
          ),
        }),
  ].filter((line) => line !== null)
  return Array.isReadonlyArrayNonEmpty(lines)
    ? lines.map((line) => h.p(styled(h, styles.quiet()), [line]))
    : [h.p(styled(h, styles.quiet()), [format(locale, 'taste.learnedEmpty', {})])]
}

/** The three parts, once what Styld knows has been read. */
const known = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const taste = AsyncData.getData(model.taste)
  const notes = Option.match(taste, { onNone: () => [], onSome: (data) => data.notes })
  return [
    h.h3([h.Id('taste-occasions'), ...styled(h, styles.partTitle())], [format(locale, 'taste.occasions', {})]),
    occasions(model, locale, h),
    Choosing.guards.Failed(model.choosing)
      ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'taste.failed', {})])
      : h.empty,
    h.h3(styled(h, styles.partTitle()), [format(locale, 'taste.notes', {})]),
    notes.length === 0
      ? h.p(styled(h, styles.quiet()), [format(locale, 'taste.notesEmpty', {})])
      : h.ul(
          styled(h, styles.notes()),
          notes.map((note) => noteLine(model, note, locale, h)),
        ),
    h.h3(styled(h, styles.partTitle()), [format(locale, 'taste.learned', {})]),
    ...Option.match(taste, { onNone: () => [], onSome: (data) => learnedLines(data.learned, locale, h) }),
  ]
}

/** What Styld knows about you, on the Account page: the parts stand from the first paint, so nothing below moves;
 * a failed first read offers Try again. */
export const tasteSection = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.section(
    [h.AriaLabelledBy('taste-setting'), ...styled(h, section())],
    [
      h.h2([h.Id('taste-setting'), ...styled(h, sectionTitle())], [format(locale, 'taste.title', {})]),
      h.p(styled(h, sectionText()), [format(locale, 'taste.reason', {})]),
      ...(AsyncData.isFailure(model.taste) && Option.isNone(AsyncData.getData(model.taste))
        ? [
            h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'common.error', {})]),
            h.div(styled(h, rowActions()), [
              actionButton(
                { label: format(locale, 'common.tryAgain', {}), style: linkAction(), onClick: Message.ClickedRetry() },
                h,
              ),
            ]),
          ]
        : known(model, locale, h)),
    ],
  ),
)
