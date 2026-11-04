import { style } from '../zyzz.config.ts'

// The new-board sheet (F-26, T-10): its way back to the templates is a quiet link at the start of its column.
export const back = style({ justifySelf: 'start', gap: 'tight' })
/** The pieces to choose from scroll in a shorter column, so the footer under them fits a phone held upright. */
export const choices = style({ maxBlockSize: '54dvh' })
/** The season and Make the outfits, under the pieces and always in view, set off from them by a hairline. */
export const footer = style({
  display: 'grid',
  gap: 'tight',
  paddingInline: '12px',
  paddingBlockStart: '8px',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
})
