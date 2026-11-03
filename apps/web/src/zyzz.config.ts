import { defineConfig } from 'zyzz'

/** Styld's Gallery 2 tokens (`DESIGN.md`, prototype in `docs/design/gallery-2`), light and dark.
 * Styles compile to `class`/`style` attributes that `Styled.ts` hands to Foldkit. */
export const { style, vars } = defineConfig({
  id: 'styld',
  output: 'html',
  vars: {
    // Every colour is a light/dark pair: the light one is Gallery's, the dark one a warm umber night. They compile to
    // `light-dark()`, so the document's `color-scheme: light dark` (GlobalStyles.ts) picks one from the device's
    // setting, with no script. Dark keeps the roles: paper is the deepest, stock and paper-2 step up from it, and the
    // ink is a warm off-white (DESIGN.md › Dark).
    color: {
      // styld.app's own paper, so wardrobe cutouts sit on it without a seam. Dark: a deep umber, never black.
      paper: { light: '#f1eee7', dark: '#17120f' },
      // Quiet surfaces: hovered controls, inactive chips, the search pill. Dark: a step above stock.
      paper2: { light: '#e7e2d9', dark: '#2a231d' },
      // A hovered paper-2 control: paper-2 mixed towards ink; repeats both literals, so change them together.
      paper2Hover: {
        light: 'color-mix(in oklab, #e7e2d9 80%, #1c1410)',
        dark: 'color-mix(in oklab, #2a231d 80%, #f2ebe2)',
      },
      // Card stock: fields, sheets and cards that sit above the paper. Dark: a step lighter than the paper.
      stock: { light: '#fbf9f5', dark: '#211b17' },
      // Text and the primary fill. Dark: a warm off-white, so a primary action is a light pill with dark words.
      ink: { light: '#1c1410', dark: '#f2ebe2' },
      // Hovered ink fill: ink mixed towards paper; repeats both literals, so change them together.
      inkHover: {
        light: 'color-mix(in oklab, #1c1410 86%, #f1eee7)',
        dark: 'color-mix(in oklab, #f2ebe2 86%, #17120f)',
      },
      // Secondary text and meta. Dark: 7.4:1 on paper-2.
      ink2: { light: '#5d554e', dark: '#bdb1a4' },
      // Tertiary text: counts, dividers' words, placeholders. At least 4.5:1 on paper, paper-2 and stock (dark: 5.1:1 on
      // paper-2, 6.1:1 on paper).
      ink3: { light: '#6b635b', dark: '#9e9286' },
      // Hairlines and field edges. Dark: quiet, a little above stock.
      rule: { light: '#ddd6cc', dark: '#3a312a' },
      // The one slate accent: link underlines and state such as work in progress (DESIGN.md › Signal). Dark: a pale
      // slate, 7.6:1 on paper-2.
      signal: { light: '#2f4f7c', dark: '#9db8e0' },
      // Text and icons on an ink fill. Dark: the paper, on the off-white ink.
      onInk: { light: '#f7f4ee', dark: '#17120f' },
      // Gallery's scrim: round controls and chips over a photo, and the shade behind a sheet. Dark: deeper, so a sheet
      // still stands off the dark page.
      scrim: { light: 'oklch(0.2 0.02 50 / 0.4)', dark: 'oklch(0.08 0.01 50 / 0.6)' },
      // Gallery's frost: a light round over a photo, such as the Gallery photo's favourite heart (T-17). It sits on the
      // photo, not the page, so it stays light in both schemes.
      frost: { light: 'oklch(0.98 0.005 80 / 0.92)', dark: 'oklch(0.98 0.005 80 / 0.92)' },
      // Gallery 2's glass: the floating nav and the Ask panel only (DESIGN.md › Surfaces), with its bright edge. Dark: a
      // smoked umber with a faint edge.
      glass: { light: 'oklch(0.985 0.005 80 / 0.74)', dark: 'oklch(0.27 0.014 55 / 0.74)' },
      glassEdge: { light: 'oklch(1 0 0 / 0.6)', dark: 'oklch(1 0 0 / 0.1)' },
      // Soft shadows for things that float: the nav, sheets, a held piece. Dark: denser, as a shadow on a dark page
      // must be to show.
      shade1: { light: 'oklch(0 0 0 / 0.05)', dark: 'oklch(0 0 0 / 0.25)' },
      shade2: { light: 'oklch(0 0 0 / 0.1)', dark: 'oklch(0 0 0 / 0.35)' },
      shade3: { light: 'oklch(0 0 0 / 0.16)', dark: 'oklch(0 0 0 / 0.45)' },
      // A board's paper tints (`Paper` in packages/protocol/src/Board.ts), used only as a table's ground, and avatar
      // tones. Dark: the same four hues, deep and quiet, so a board keeps its colour and cutouts stay the brightest
      // thing on it.
      tintSand: { light: '#e0d3b8', dark: '#3d3426' },
      tintSage: { light: '#c3cbb7', dark: '#2e3529' },
      tintSlate: { light: '#bec8d4', dark: '#2a313b' },
      tintClay: { light: '#dcc0ad', dark: '#3e2f26' },
      // The other avatar tones behind a person's initials (with the tints above and ink).
      toneStone: { light: '#d3cdc3', dark: '#38322c' },
      tonePlum: { light: '#cfc1ca', dark: '#3a2e36' },
      toneOlive: { light: '#cdcbad', dark: '#363526' },
      // The keyboard focus ring. Dark: a lighter blue, 6.7:1 on paper-2.
      focus: { light: '#2f5bd3', dark: '#8aa8ff' },
      // Error text, and an invalid field's edge. Dark: lighter reds that keep 4.5:1 (text) and 3:1 (edge) on stock.
      error: { light: 'oklch(48% 0.16 25)', dark: 'oklch(74% 0.13 25)' },
      invalid: { light: 'oklch(58% 0.16 25)', dark: 'oklch(66% 0.15 25)' },
      // The thirteen colours a piece can have, as swatches (v1's CATALOG_COLOR_HEX): the colour itself in either scheme.
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
    // The type scale (DESIGN.md › Type), named by role.
    fontSize: {
      // The landing's statement, and the Today table's headline in the logo's voice.
      display: 'clamp(46px, 34px + 3vw, 72px)',
      headline: 'clamp(52px, 40px + 4vw, 76px)',
      // Camera countdown, read from across the room while someone holds a garment.
      countdown: 'clamp(96px, 30vmin, 180px)',
      // H1, and an H1 inside a panel (a piece's name, a gallery's title).
      title: '30px',
      name: '28px',
      panelTitle: '26px',
      // H2; also the large avatar's initials.
      heading: '22px',
      // H3 and the lede.
      subheading: '17px',
      body: '16px',
      control: '15px',
      label: '14px',
      small: '13px',
      micro: '12px',
      // The small avatar's initials.
      tiny: '10px',
      // Icons set in text, sized by the font.
      icon: '20px',
      iconLarge: '24px',
      // A board's text items, against the table's width.
      boardText: '7cqw',
      boardHeadline: '12cqw',
      // Form controls take the document's size, whatever the browser's default.
      root: '1rem',
    },
    // Gaps between things in a row or grid (DESIGN.md › Spacing: 8px between actions, 16px between grid items).
    gap: {
      hairline: '2px',
      tight: '4px',
      snug: '6px',
      actions: '8px',
      close: '10px',
      related: '12px',
      cozy: '14px',
      grid: '16px',
      gutter: '20px',
      section: '24px',
      wide: '28px',
      column: '32px',
      columnWide: '40px',
      columns: '48px',
    },
    // Gallery's curve for press, colour and hover; the springs things that travel settle on (DESIGN.md › Motion).
    ease: {
      standard: 'cubic-bezier(0.2, 0, 0, 1)',
      out: 'ease-out',
      steady: 'linear',
      spring:
        'linear(0, 0.0357, 0.1183, 0.2215, 0.3294, 0.433, 0.5273, 0.6104, 0.6819, 0.7423, 0.7925, 0.8339, 0.8677, 0.895, 0.9171, 0.9347, 0.9487, 0.9598, 0.9686, 0.9755, 0.9809, 0.9852, 0.9885, 0.9911, 0.9931, 0.9947, 0.9959, 0.9968, 0.9976, 0.9981, 0.9986, 0.9989, 1)',
      springBounce:
        'linear(0, 0.0491, 0.1629, 0.3039, 0.4479, 0.5806, 0.6949, 0.7883, 0.8613, 0.9159, 0.9549, 0.9815, 0.9985, 1.0085, 1.0134, 1.0151, 1.0147, 1.0132, 1.0111, 1.0089, 1.0068, 1.005, 1.0035, 1.0023, 1.0014, 1.0008, 1.0004, 1.0001, 0.9999, 0.9998, 0.9998, 0.9998, 1)',
    },
    // How long a motion takes (DESIGN.md › Motion).
    transitionDuration: {
      // Press and colour.
      press: '140ms',
      // Hover, menus and the tab cross-fade.
      hover: '180ms',
      fade: '160ms',
      // A sheet or an item entering.
      enter: '240ms',
      // Something that travels, such as the + sheet growing.
      travel: '420ms',
      settle: '560ms',
      spring: '700ms',
      brief: '200ms',
      // A loader's turn.
      spin: '0.9s',
      instant: '0ms',
    },
    // inset: a table inside a card with 8px padding, so its corner is the card's 16px less the padding.
    radius: { photo: '4px', inset: '8px', field: '12px', panel: '16px', sheet: '24px', table: '28px', pill: '999px' },
    // A shadow holds its colours as `light-dark()` pairs, as the colour tokens compile to: denser on the dark paper.
    // The rings repeat their colour token's literals (rule, ink, signal, paper, ink-3), so change them together.
    shadow: {
      // Gallery's lift-1: a card or a sheet's panel resting just above the paper.
      lift1:
        '0 1px 2px light-dark(oklch(0 0 0 / 0.05), oklch(0 0 0 / 0.3)), 0 8px 24px light-dark(oklch(0 0 0 / 0.05), oklch(0 0 0 / 0.3))',
      // A sheet or the Ask panel rising from the bottom edge.
      sheet: '0 -8px 32px light-dark(oklch(0 0 0 / 0.14), oklch(0 0 0 / 0.5))',
      // A hairline inside an edge, in rule: a table's paper, a frame around a picture, the search pill.
      edge: 'inset 0 0 0 1px light-dark(#ddd6cc, #3a312a)',
      // The chosen tile, or the focused search pill: a 1.5px ink ring inside the edge.
      chosen: 'inset 0 0 0 1.5px light-dark(#1c1410, #f2ebe2)',
      // A table taking dropped pictures: a 2px signal ring inside its edge.
      dropTarget: 'inset 0 0 0 2px light-dark(#2f4f7c, #9db8e0)',
      // A paper halo that keeps the resize handle's dot clear of what it sits on.
      handleHalo: '0 0 0 3px light-dark(#f1eee7, #17120f)',
      // Gallery's lift-2: something raised above the page, as the ink Ask circle.
      lift2:
        '0 2px 6px light-dark(oklch(0 0 0 / 0.1), oklch(0 0 0 / 0.35)), 0 20px 48px light-dark(oklch(0 0 0 / 0.1), oklch(0 0 0 / 0.35))',
      // The floating glass nav and rail: a light inner edge over lift-2.
      glass:
        'inset 0 0 0 1px light-dark(oklch(1 0 0 / 0.6), oklch(1 0 0 / 0.1)), 0 2px 6px light-dark(oklch(0 0 0 / 0.1), oklch(0 0 0 / 0.35)), 0 20px 48px light-dark(oklch(0 0 0 / 0.1), oklch(0 0 0 / 0.35))',
      // A small round over a picture, such as a pin's ×.
      overPhoto: '0 1px 4px light-dark(oklch(0 0 0 / 0.12), oklch(0 0 0 / 0.4))',
      // A switch that is off: a 1.5px ink-3 ring, so its edge keeps 3:1 on the paper (WCAG 1.4.11).
      switchEdge: 'inset 0 0 0 1.5px light-dark(#6b635b, #9e9286)',
    },
  },
})

/** Dark only (DESIGN.md › Dark): a faint warm glow that follows a cutout's own edge, so a dark garment (a black shoe, a
 * navy knit) stands off the dark paper instead of sinking into it. `filter` takes no token, so its value lives here with
 * the colours. On an uncut photo it rims the picture's rectangle, as softly. */
export const cutoutGlow = 'drop-shadow(0 0 8px oklch(0.9 0.03 70 / 0.16))'

/** A press and a hover on one element (`transform` then a colour or `translate`): a duration token holds one time, so
 * the pair of the press and hover tokens is written here, where every other motion value lives. */
export const pressThenHover = '140ms, 180ms !custom'
