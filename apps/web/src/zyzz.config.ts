import { defineConfig } from 'zyzz'

/** Styld's Gallery tokens (`DESIGN.md`, prototype in `docs/design/gallery`). Light mode only.
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
      // Card stock: fields, sheets and cards that sit above the paper.
      stock: '#fbf9f5',
      ink: '#1c1410',
      // Hovered ink fill: ink mixed towards paper; repeats both literals, so change them together.
      inkHover: 'color-mix(in oklab, #1c1410 86%, #f1eee7)',
      // Secondary text and meta.
      ink2: '#5d554e',
      // Tertiary text: counts, dividers' words, placeholders.
      ink3: '#8b827a',
      rule: '#ddd6cc',
      // The one slate accent: link underlines and state such as work in progress (DESIGN.md › Signal).
      signal: '#2f4f7c',
      // Text and icons on an ink fill.
      onInk: '#f7f4ee',
      focus: '#2f5bd3',
      error: 'oklch(48% 0.16 25)',
      invalid: 'oklch(58% 0.16 25)',
    },
    fontFamily: {
      body: "'Hanken Grotesk Variable', 'Hanken Grotesk', system-ui, sans-serif",
    },
    radius: { photo: '4px', field: '12px', panel: '16px', sheet: '24px', pill: '999px' },
  },
})
