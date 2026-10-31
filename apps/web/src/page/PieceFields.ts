import { Button } from '@foldkit/ui'
import {
  type Colour,
  Colour as ColourSchema,
  GarmentGroup,
  Occasion,
  Pattern,
  PieceType,
  Season,
  typesIn,
} from '@styld/protocol'
import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Array, Option, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { checkIcon } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { cx } from 'zyzz'
import { colourName, groupName, occasionName, patternName, seasonName, typeName } from './WardrobeWords.ts'
import * as styles from './PieceFields.styles.ts'

const colours: ReadonlyArray<Colour> = ColourSchema.literals

/** At most six colours per piece; the picker refuses a seventh. */
const maximumColours = 6

/** What a piece form holds of a piece: the type it must have, its colours and the attributes it may have. */
export const Details = Schema.Struct({
  type: Schema.Option(PieceType),
  colours: Schema.Array(ColourSchema),
  season: Schema.Option(Season),
  occasions: Schema.Array(Occasion),
  pattern: Schema.Option(Pattern),
})
export type Details = typeof Details.Type

/** A piece's details as the forms start from them: what it is, or what the decision model suggested. */
export const detailsOf = (piece: {
  readonly type: PieceType | null
  readonly colours: ReadonlyArray<Colour>
  readonly season: Season | null
  readonly occasions: ReadonlyArray<Occasion>
  readonly pattern: Pattern | null
}): Details => ({
  type: Option.fromNullishOr(piece.type),
  colours: piece.colours,
  season: Option.fromNullishOr(piece.season),
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
  season: (season: Season) => (details: Details) => ({ ...details, season: chosenAgain(season, details.season) }),
  occasion: (occasion: Occasion) => (details: Details) => ({
    ...details,
    occasions: toggled(occasion, Occasion.literals.length)(details.occasions),
  }),
  pattern: (pattern: Pattern) => (details: Details) => ({ ...details, pattern: chosenAgain(pattern, details.pattern) }),
}

/** The details as the API takes them: a type, and attributes only where there are any. */
export const detailsPayload = (details: Details) => ({
  ...(details.colours.length === 0 ? {} : { colours: details.colours }),
  ...Option.match(details.season, { onNone: () => ({}), onSome: (season) => ({ season }) }),
  ...(details.occasions.length === 0 ? {} : { occasions: details.occasions }),
  ...Option.match(details.pattern, { onNone: () => ({}), onSome: (pattern) => ({ pattern }) }),
})

type Labelled = Readonly<{ id: string; legend: MessageKey; problem: Option.Option<MessageKey> }>

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
  config: Labelled & Readonly<{ chosen: Option.Option<PieceType>; onChoose: (type: PieceType) => Message }>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  group(
    config,
    styles.typeGroups(),
    GarmentGroup.literals.map((garmentGroup) =>
      h.div(styled(h, styles.typeGroup()), [
        h.span(styled(h, styles.typeGroupName()), [format(locale, groupName(garmentGroup), {})]),
        h.div(
          styled(h, styles.chipSet()),
          typesIn(garmentGroup).map((type) =>
            chip(format(locale, typeName(type), {}), Option.contains(config.chosen, type), config.onChoose(type), h),
          ),
        ),
      ]),
    ),
    locale,
    h,
  )

/** Chips for one optional value or several, named from the catalogs. */
const chipPicker = <Message, A extends string>(
  config: Labelled &
    Readonly<{
      values: ReadonlyArray<A>
      name: (value: A) => MessageKey
      isChosen: (value: A) => boolean
      onChoose: (value: A) => Message
    }>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  group(
    config,
    styles.chipSet(),
    config.values.map((value) =>
      chip(format(locale, config.name(value), {}), config.isChosen(value), config.onChoose(value), h),
    ),
    locale,
    h,
  )

/** Up to six colours, as swatches named for assistive technology. */
const colourPicker = <Message>(
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

/** The Messages a piece form sends from its pickers; a page passes its own Message union. */
type PickerMessages<Message> = Readonly<{
  ChoseType: (fields: { readonly type: PieceType }) => Message
  ToggledColour: (fields: { readonly colour: Colour }) => Message
  ChoseSeason: (fields: { readonly season: Season }) => Message
  ToggledOccasion: (fields: { readonly occasion: Occasion }) => Message
  ChosePattern: (fields: { readonly pattern: Pattern }) => Message
}>

/** The pickers in the order both piece forms show them: what it is, its colours, then when, what for and its
 * pattern. */
export const piecePickers = <Message>(
  config: Readonly<{
    details: Details
    typeMissing: boolean
    coloursLegend: MessageKey
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
    },
    locale,
    h,
  ),
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
  chipPicker(
    {
      id: 'piece-season',
      legend: 'wardrobe.seasonLabel',
      problem: Option.none(),
      values: Season.literals,
      name: seasonName,
      isChosen: (season) => Option.contains(config.details.season, season),
      onChoose: (season) => config.messages.ChoseSeason({ season }),
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
      name: occasionName,
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
      name: patternName,
      isChosen: (pattern) => Option.contains(config.details.pattern, pattern),
      onChoose: (pattern) => config.messages.ChosePattern({ pattern }),
    },
    locale,
    h,
  ),
]
