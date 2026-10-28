import { defineConfig } from 'zyzz'

/** Styld's Atelier tokens, carried over from v1 (`DESIGN.md`). Light mode only.
 * Styles compile to `class`/`style` attributes that `Styled.ts` hands to Foldkit. */
export const { style, vars } = defineConfig({
  id: 'styld',
  output: 'html',
  vars: {
    color: {
      paper: 'oklch(94.5% 0.01 76)',
      ink: 'oklch(19% 0.024 52)',
      muted: 'oklch(47% 0.014 60)',
      rule: 'oklch(81% 0.011 70)',
      focus: 'oklch(50% 0.095 248)',
      // The one slate accent: state such as work in progress or the current selection (DESIGN.md › Signal).
      signal: 'oklch(41% 0.075 248)',
      error: 'oklch(48% 0.16 25)',
      invalid: 'oklch(58% 0.16 25)',
      // Input fields and hovered secondary actions: paper tinted towards ink. These repeat the
      // paper and ink literals, so change them together.
      field: 'color-mix(in oklch, oklch(94.5% 0.01 76) 88%, oklch(19% 0.024 52))',
      hover: 'color-mix(in oklch, oklch(94.5% 0.01 76) 90%, oklch(19% 0.024 52))',
    },
    fontFamily: {
      body: "'Hanken Grotesk Variable', 'Hanken Grotesk', system-ui, sans-serif",
      display: "'Sentient', Georgia, serif",
    },
    radius: { control: '3px' },
  },
})
