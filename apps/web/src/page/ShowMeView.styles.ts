import { style } from '../zyzz.config.ts'

export { chip, chosen, problem } from '../Controls.styles.ts'

// Show me on Home: a quiet card above What's new, ringed in rule on the paper, that asks once after sign-in.

export const card = style({
  display: 'grid',
  gap: 'related',
  marginBlockEnd: '16px',
  padding: '16px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'panel',
})
export const title = style({ margin: '0', fontSize: 'subheading', fontWeight: 600 })
export const reason = style({ margin: '0', fontSize: 'label', color: 'ink2', lineHeight: 1.5 })
/** The choices, wrapping on a narrow screen, with "Not now" at the end. */
export const choices = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'actions' })
