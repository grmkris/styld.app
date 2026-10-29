import { Button } from '@foldkit/ui'
import {
  type Category,
  type Colour,
  Colour as ColourSchema,
  Category as CategorySchema,
  subcategories,
  type Subcategory,
} from '@styld/protocol'
import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { checkIcon } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { categoryName, colourName, subcategoryName } from './WardrobeWords.ts'
import * as styles from './PieceFields.styles.ts'

/** Every category and colour, in the order the pickers show them. */
export const categories: ReadonlyArray<Category> = CategorySchema.literals
const colours: ReadonlyArray<Colour> = ColourSchema.literals

/** At most six colours per piece; the picker refuses a seventh. */
const maximumColours = 6

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

/** One required category, as chips. */
const categoryPicker = <Message>(
  config: Labelled & Readonly<{ chosen: Option.Option<Category>; onChoose: (category: Category) => Message }>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  group(
    config,
    styles.chipSet(),
    categories.map((category) =>
      chip(
        format(locale, categoryName(category), {}),
        Option.contains(config.chosen, category),
        config.onChoose(category),
        h,
      ),
    ),
    locale,
    h,
  )

/** The shelves of the chosen category; choosing the chosen one again clears it. */
const subcategoryPicker = <Message>(
  config: Labelled &
    Readonly<{
      category: Category
      chosen: Option.Option<Subcategory>
      onChoose: (subcategory: Option.Option<Subcategory>) => Message
    }>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  group(
    config,
    styles.chipSet(),
    subcategories[config.category].map((subcategory) => {
      const chosen = Option.contains(config.chosen, subcategory)
      return chip(
        format(locale, subcategoryName(subcategory), {}),
        chosen,
        config.onChoose(chosen ? Option.none() : Option.some(subcategory)),
        h,
      )
    }),
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

/** Choosing a colour adds it, choosing it again removes it, and a seventh is refused. */
export const toggleColour =
  (colour: Colour) =>
  (chosen: ReadonlyArray<Colour>): ReadonlyArray<Colour> =>
    chosen.includes(colour)
      ? Array.filter(chosen, (each) => each !== colour)
      : chosen.length >= maximumColours
        ? chosen
        : [...chosen, colour]

/** A piece's swatches as read-only dots, each named. */
export const swatches = <Message>(chosen: ReadonlyArray<Colour>, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.ul(
    [h.AriaLabel(format(locale, 'wardrobe.colorsLabel', {})), ...styled(h, styles.swatchSet())],
    chosen.map((colour) =>
      h.li([
        h.Role('img'),
        h.AriaLabel(format(locale, colourName(colour), {})),
        h.DataAttribute('colour', colour),
        ...styled(h, styles.swatchDot()),
      ]),
    ),
  )

/** The Messages a piece form sends from its pickers; a page passes its own Message union. */
type PickerMessages<Message> = Readonly<{
  ChoseCategory: (fields: { readonly category: Category }) => Message
  ChoseSubcategory: (fields: { readonly subcategory: Option.Option<Subcategory> }) => Message
  ToggledColour: (fields: { readonly colour: Colour }) => Message
}>

/** The three pickers in the order both piece forms show them; the shelves wait for a category. */
export const piecePickers = <Message>(
  config: Readonly<{
    category: Option.Option<Category>
    categoryMissing: boolean
    subcategory: Option.Option<Subcategory>
    colours: ReadonlyArray<Colour>
    coloursLegend: MessageKey
    messages: PickerMessages<Message>
  }>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  categoryPicker(
    {
      id: 'piece-category',
      legend: 'wardrobe.categoryLabel',
      problem: config.categoryMissing ? Option.some('wardrobe.addPieceNeedsCategory') : Option.none(),
      chosen: config.category,
      onChoose: (category) => config.messages.ChoseCategory({ category }),
    },
    locale,
    h,
  ),
  Option.match(config.category, {
    onNone: () => h.empty,
    onSome: (category) =>
      subcategoryPicker(
        {
          id: 'piece-subcategory',
          legend: 'wardrobe.shelves.shelfLabel',
          problem: Option.none(),
          category,
          chosen: config.subcategory,
          onChoose: (subcategory) => config.messages.ChoseSubcategory({ subcategory }),
        },
        locale,
        h,
      ),
  }),
  colourPicker(
    {
      id: 'piece-colours',
      legend: config.coloursLegend,
      problem: Option.none(),
      chosen: config.colours,
      onToggle: (colour) => config.messages.ToggledColour({ colour }),
    },
    locale,
    h,
  ),
]
