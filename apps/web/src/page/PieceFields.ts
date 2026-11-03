import { Button } from '@foldkit/ui'
import {
  type Colour,
  Colour as ColourSchema,
  GarmentGroup,
  groupOf,
  Occasion,
  Pattern,
  PieceType,
  Season,
  typesIn,
  maximumColours,
  textLength,
} from '@styld/protocol'
import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Array, Option, Order, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { fieldLabel, textField } from '../Fields.styles.ts'
import { checkIcon } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { cx } from 'zyzz'
import { colourName, groupName, occasionName, patternName, seasonName, typeName } from './WardrobeWords.ts'
import * as styles from './PieceFields.styles.ts'

const colours: ReadonlyArray<Colour> = ColourSchema.literals

/** At most six colours per piece; the picker refuses a seventh. */

/** What a piece form holds of a piece: the type it must have, its colours and the attributes it may have. */
export const Details = Schema.Struct({
  type: Schema.Option(PieceType),
  colours: Schema.Array(ColourSchema),
  /** The seasons it is worn in, none for all year, and whether it is made for rain (T-12). */
  seasons: Schema.Array(Season),
  rainproof: Schema.Boolean,
  /** The person's own category under the type, as typed; empty is none (T-12). */
  category: Schema.String,
  occasions: Schema.Array(Occasion),
  pattern: Schema.Option(Pattern),
})
export type Details = typeof Details.Type

/** A piece's details as the forms start from them: what it is, or what the decision model suggested. */
export const detailsOf = (piece: {
  readonly type: PieceType | null
  readonly colours: ReadonlyArray<Colour>
  readonly seasons: ReadonlyArray<Season>
  readonly rainproof: boolean
  readonly category?: string | null
  readonly occasions: ReadonlyArray<Occasion>
  readonly pattern: Pattern | null
}): Details => ({
  type: Option.fromNullishOr(piece.type),
  colours: piece.colours,
  seasons: piece.seasons,
  rainproof: piece.rainproof,
  category: piece.category ?? '',
  occasions: piece.occasions,
  pattern: Option.fromNullishOr(piece.pattern),
})

/** Choosing a value adds it, choosing it again removes it, and one past `most` is refused. */
const toggled =
  <A>(value: A, most: number) =>
  (chosen: ReadonlyArray<A>): ReadonlyArray<A> =>
    chosen.includes(value)
      ? Array.filter(chosen, (each) => each !== value)
      : chosen.length >= most
        ? chosen
        : [...chosen, value]

/** Choosing the chosen one again clears it. */
const chosenAgain = <A>(value: A, chosen: Option.Option<A>): Option.Option<A> =>
  Option.contains(chosen, value) ? Option.none() : Option.some(value)

/** How each picker changes a piece's details. */
export const changeDetails = {
  type: (type: PieceType) => (details: Details) => ({ ...details, type: Option.some(type) }),
  colour: (colour: Colour) => (details: Details) => ({
    ...details,
    colours: toggled(colour, maximumColours)(details.colours),
  }),
  /** A season chosen or unchosen, or Rainproof (T-12). */
  worn: (when: WornWhen) => (details: Details) =>
    when === 'rainproof'
      ? { ...details, rainproof: !details.rainproof }
      : { ...details, seasons: toggled(when, Season.literals.length)(details.seasons) },
  occasion: (occasion: Occasion) => (details: Details) => ({
    ...details,
    occasions: toggled(occasion, Occasion.literals.length)(details.occasions),
  }),
  pattern: (pattern: Pattern) => (details: Details) => ({ ...details, pattern: chosenAgain(pattern, details.pattern) }),
  category: (category: string) => (details: Details) => ({ ...details, category }),
  /** One of the person's categories chosen, with its type; chosen again, the piece is under its type alone. */
  chosenCategory: (category: PieceCategory) => (details: Details) =>
    isCategory(details, category)
      ? { ...details, category: '' }
      : { ...details, type: Option.some(category.type), category: category.name },
}

/** One of the person's own categories under a type (T-12). */
export interface PieceCategory {
  readonly type: PieceType
  readonly name: string
}

const isCategory = (details: Details, category: PieceCategory) =>
  Option.contains(details.type, category.type) && details.category.trim().toLowerCase() === category.name.toLowerCase()

/** The person's categories, from their pieces: each type and name once, in the order the names sort. */
export const categoriesOf = (
  pieces: ReadonlyArray<{ readonly type: PieceType; readonly category: string | null }>,
): ReadonlyArray<PieceCategory> =>
  Array.sort(
    Array.dedupeWith(
      pieces.flatMap(({ type, category }) => (category === null ? [] : [{ type, name: category }])),
      (left, right) => left.type === right.type && left.name === right.name,
    ),
    Order.mapInput(Order.String, (category: PieceCategory) => category.name),
  )

/** The details as the API takes them: a type, and attributes only where there are any. */
export const detailsPayload = (details: Details) => ({
  ...(details.colours.length === 0 ? {} : { colours: details.colours }),
  ...(details.seasons.length === 0 ? {} : { seasons: details.seasons }),
  ...(details.rainproof ? { rainproof: true } : {}),
  ...(details.category.trim() === '' ? {} : { category: details.category.trim() }),
  ...(details.occasions.length === 0 ? {} : { occasions: details.occasions }),
  ...Option.match(details.pattern, { onNone: () => ({}), onSome: (pattern) => ({ pattern }) }),
})

export type Labelled = Readonly<{ id: string; legend: MessageKey; problem: Option.Option<MessageKey> }>

const group = <Message>(
  { id, legend, problem }: Labelled,
  setStyle: Styles.Attributes,
  children: ReadonlyArray<Html>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.fieldset(
    [
      ...styled(h, styles.picker()),
      ...(Option.isSome(problem) ? [h.AriaDescribedBy(`${id}-problem`), h.AriaInvalid(true)] : []),
    ],
    [
      h.legend(styled(h, styles.pickerLegend()), [format(locale, legend, {})]),
      h.div(styled(h, setStyle), [...children]),
      Option.match(problem, {
        onNone: () => h.empty,
        onSome: (key) =>
          h.p(
            [h.Id(`${id}-problem`), h.Role('alert'), ...styled(h, styles.pickerProblem())],
            [format(locale, key, {})],
          ),
      }),
    ],
  )

const chip = <Message>(label: string, pressed: boolean, onClick: Message, h: HtmlBuilder<Message>): Html =>
  Button.view(
    {
      onClick,
      toView: (attributes) =>
        h.button([...attributes.button, h.AriaPressed(String(pressed)), ...styled(h, styles.chip())], [label]),
    },
    h,
  )

/** One required type, as chips under their group's name, the way a shop lists them. */
const typePicker = <Message>(
  config: Labelled &
    Readonly<{
      chosen: Option.Option<PieceType>
      onChoose: (type: PieceType) => Message
      details: Details
      categories: ReadonlyArray<PieceCategory>
      onChooseCategory: (category: PieceCategory) => Message
    }>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  group(
    config,
    styles.typeGroups(),
    GarmentGroup.literals.map((garmentGroup) =>
      h.div(styled(h, styles.typeGroup()), [
        h.span(styled(h, styles.typeGroupName()), [format(locale, groupName(garmentGroup), {})]),
        h.div(styled(h, styles.chipSet()), [
          ...typesIn(garmentGroup).map((type) =>
            chip(
              format(locale, typeName(type), {}),
              Option.contains(config.chosen, type) && config.details.category.trim() === '',
              config.onChoose(type),
              h,
            ),
          ),
          // The person's own categories sit beside the shop's types (T-12).
          ...config.categories
            .filter(({ type }) => groupOf(type) === garmentGroup)
            .map((category) =>
              chip(category.name, isCategory(config.details, category), config.onChooseCategory(category), h),
            ),
        ]),
      ]),
    ),
    locale,
    h,
  )

/** Chips for one optional value or several, each with its label. */
export const chipPicker = <Message, A extends string>(
  config: Labelled &
    Readonly<{
      values: ReadonlyArray<A>
      label: (value: A) => string
      isChosen: (value: A) => boolean
      onChoose: (value: A) => Message
    }>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  group(
    config,
    styles.chipSet(),
    config.values.map((value) => chip(config.label(value), config.isChosen(value), config.onChoose(value), h)),
    locale,
    h,
  )

/** Up to six colours, as swatches named for assistive technology. */
export const colourPicker = <Message>(
  config: Labelled & Readonly<{ chosen: ReadonlyArray<Colour>; onToggle: (colour: Colour) => Message }>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  group(
    config,
    styles.swatchSet(),
    colours.map((colour) => {
      const chosen = config.chosen.includes(colour)
      const full = !chosen && config.chosen.length >= maximumColours
      return Button.view(
        {
          onClick: config.onToggle(colour),
          isDisabled: full,
          toView: (attributes) =>
            h.button(
              [
                ...attributes.button,
                h.AriaPressed(String(chosen)),
                h.AriaLabel(format(locale, colourName(colour), {})),
                ...styled(h, styles.swatch()),
              ],
              [
                h.span(
                  [h.AriaHidden(true), h.DataAttribute('colour', colour), ...styled(h, styles.swatchDot())],
                  [chosen ? checkIcon(h) : h.empty],
                ),
              ],
            ),
        },
        h,
      )
    }),
    locale,
    h,
  )

/** A piece's colours as a fact: each dot beside its name, since a dot alone cannot tell blue from navy. */
export const colourList = <Message>(chosen: ReadonlyArray<Colour>, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.ul(
    styled(h, styles.colourList()),
    chosen.map((colour) =>
      h.li(styled(h, styles.colourItem()), [
        h.span([
          h.AriaHidden(true),
          h.DataAttribute('colour', colour),
          ...styled(h, cx(styles.swatchDot(), styles.factDot())),
        ]),
        format(locale, colourName(colour), {}),
      ]),
    ),
  )

/** When a piece is worn, as the forms and the filter offer it: the four seasons, then Rainproof. */
export const WornWhen = Schema.Literals([...Season.literals, 'rainproof'])
export type WornWhen = typeof WornWhen.Type

/** The Messages a piece form sends from its pickers; a page passes its own Message union. */
type PickerMessages<Message> = Readonly<{
  ChoseType: (fields: { readonly type: PieceType }) => Message
  ToggledColour: (fields: { readonly colour: Colour }) => Message
  ToggledWorn: (fields: { readonly when: WornWhen }) => Message
  UpdatedCategory: (fields: { readonly value: string }) => Message
  ChoseCategory: (fields: { readonly type: PieceType; readonly name: string }) => Message
  ToggledOccasion: (fields: { readonly occasion: Occasion }) => Message
  ChosePattern: (fields: { readonly pattern: Pattern }) => Message
}>

/** A category of the person's own under the type: typed new, or one of theirs chosen among the types (T-12). */
const categoryField = <Message>(
  details: Details,
  messages: PickerMessages<Message>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.label([h.For('piece-category'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.categoryLabel', {})]),
  h.input([
    h.Id('piece-category'),
    h.Name('category'),
    h.Type('text'),
    h.Maxlength(textLength.category),
    h.Placeholder(format(locale, 'wardrobe.categoryPlaceholder', {})),
    h.Value(details.category),
    h.OnInput((value) => messages.UpdatedCategory({ value })),
    ...styled(h, textField()),
  ]),
]

/** The pickers in the order both piece forms show them: what it is, its colours, then when, what for and its
 * pattern. */
export const piecePickers = <Message>(
  config: Readonly<{
    details: Details
    typeMissing: boolean
    coloursLegend: MessageKey
    categories: ReadonlyArray<PieceCategory>
    messages: PickerMessages<Message>
  }>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  typePicker(
    {
      id: 'piece-type',
      legend: 'wardrobe.typeLabel',
      problem: config.typeMissing ? Option.some('wardrobe.needsType') : Option.none(),
      chosen: config.details.type,
      onChoose: (type) => config.messages.ChoseType({ type }),
      details: config.details,
      categories: config.categories,
      onChooseCategory: (category) => config.messages.ChoseCategory(category),
    },
    locale,
    h,
  ),
  ...categoryField(config.details, config.messages, locale, h),
  colourPicker(
    {
      id: 'piece-colours',
      legend: config.coloursLegend,
      problem: Option.none(),
      chosen: config.details.colours,
      onToggle: (colour) => config.messages.ToggledColour({ colour }),
    },
    locale,
    h,
  ),
  // Any of the four seasons, none for all year, and Rainproof beside them (Eva's review, F-45).
  chipPicker(
    {
      id: 'piece-season',
      legend: 'wardrobe.seasonLabel',
      problem: Option.none(),
      values: WornWhen.literals,
      label: (when) => format(locale, when === 'rainproof' ? 'wardrobe.rainproof' : seasonName(when), {}),
      isChosen: (when) => (when === 'rainproof' ? config.details.rainproof : config.details.seasons.includes(when)),
      onChoose: (when) => config.messages.ToggledWorn({ when }),
    },
    locale,
    h,
  ),
  chipPicker(
    {
      id: 'piece-occasions',
      legend: 'wardrobe.occasionsLabel',
      problem: Option.none(),
      values: Occasion.literals,
      label: (occasion) => format(locale, occasionName(occasion), {}),
      isChosen: (occasion) => config.details.occasions.includes(occasion),
      onChoose: (occasion) => config.messages.ToggledOccasion({ occasion }),
    },
    locale,
    h,
  ),
  chipPicker(
    {
      id: 'piece-pattern',
      legend: 'wardrobe.patternLabel',
      problem: Option.none(),
      values: Pattern.literals,
      label: (pattern) => format(locale, patternName(pattern), {}),
      isChosen: (pattern) => Option.contains(config.details.pattern, pattern),
      onChoose: (pattern) => config.messages.ChosePattern({ pattern }),
    },
    locale,
    h,
  ),
]
