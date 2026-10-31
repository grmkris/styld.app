import { defineConfig } from 'zyzz'

/** Styld's Gallery 2 tokens (`DESIGN.md`, prototype in `docs/design/gallery-2`). Light mode only.
 * Styles compile to `class`/`style` attributes that `Styled.ts` hands to Foldkit. */
export const { style, vars } = defineConfig({
  id: 'styld',
  output: 'html',
  vars: {
    color: {
      // styld.app's own paper, so wardrobe cutouts sit on it without a seam.
      paper: '#f1eee7',
      // Quiet surfaces: hovered controls, inactive chips, the search pill.
      paper2: '#e7e2d9',
      // A hovered paper-2 control: paper-2 mixed towards ink; repeats both literals, so change them together.
      paper2Hover: 'color-mix(in oklab, #e7e2d9 80%, #1c1410)',
      // Card stock: fields, sheets and cards that sit above the paper.
      stock: '#fbf9f5',
      ink: '#1c1410',
      // Hovered ink fill: ink mixed towards paper; repeats both literals, so change them together.
      inkHover: 'color-mix(in oklab, #1c1410 86%, #f1eee7)',
      // Secondary text and meta.
      ink2: '#5d554e',
      // Tertiary text: counts, dividers' words, placeholders. At least 4.5:1 on paper, paper-2 and stock.
      ink3: '#6b635b',
      rule: '#ddd6cc',
      // The one slate accent: link underlines and state such as work in progress (DESIGN.md › Signal).
      signal: '#2f4f7c',
      // Text and icons on an ink fill.
      onInk: '#f7f4ee',
      // Gallery's scrim: round controls and chips over a photo, such as the camera's picture.
      scrim: 'oklch(0.2 0.02 50 / 0.4)',
      // Gallery 2's glass: the floating nav and the Ask panel only (DESIGN.md › Surfaces), with its bright edge.
      glass: 'oklch(0.985 0.005 80 / 0.74)',
      glassEdge: 'oklch(1 0 0 / 0.6)',
      // Soft shadows for things that float: the nav, sheets, a held piece.
      shade1: 'oklch(0 0 0 / 0.05)',
      shade2: 'oklch(0 0 0 / 0.1)',
      shade3: 'oklch(0 0 0 / 0.16)',
      // A board's paper tints (`Paper` in packages/protocol/src/Board.ts), used only as a table's ground.
      tintSand: '#e0d3b8',
      tintSage: '#c3cbb7',
      tintSlate: '#bec8d4',
      tintClay: '#dcc0ad',
      // The other avatar tones behind a person's initials (with the tints above and ink).
      toneStone: '#d3cdc3',
      tonePlum: '#cfc1ca',
      toneOlive: '#cdcbad',
      focus: '#2f5bd3',
      error: 'oklch(48% 0.16 25)',
      invalid: 'oklch(58% 0.16 25)',
      // The thirteen colours a piece can have, as swatches (v1's CATALOG_COLOR_HEX).
      swatchBlack: '#111111',
      swatchWhite: '#ffffff',
      swatchGrey: '#8a8a8a',
      swatchBeige: '#d8c3a5',
      swatchBrown: '#7b4b2a',
      swatchNavy: '#1f2a44',
      swatchBlue: '#3b6fd8',
      swatchGreen: '#3c7a4a',
      swatchRed: '#c0392b',
      swatchPink: '#e8a0b4',
      swatchYellow: '#f2c94c',
      swatchOrange: '#e67e22',
      swatchPurple: '#7d4ca6',
    },
    fontFamily: {
      // The fallback is Arial sized to Hanken's metrics (GlobalStyles.ts), so text keeps its place when the face lands.
      body: "'Hanken Grotesk Variable', 'Hanken Grotesk Fallback', system-ui, sans-serif",
      // The logo's condensed voice: the table's headline and headline labels on a board, nowhere else.
      voice: "'Anton', 'Hanken Grotesk Variable', sans-serif",
    },
    radius: { photo: '4px', field: '12px', panel: '16px', sheet: '24px', table: '28px', pill: '999px' },
  },
})
