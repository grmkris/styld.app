import { cutoutGlow, style } from '../../zyzz.config.ts'

export const filters = style({ display: 'flex', flexWrap: 'wrap', gap: 'actions' })
export const filter = style({ minBlockSize: '44px' })
export const image = style({
  inlineSize: '100%',
  blockSize: '100%',
  minBlockSize: '0',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  pointerEvents: 'none',
  // DESIGN.md › Dark: a dark garment keeps its edge on the dark sheet.
  '@media (prefers-color-scheme: dark)': { filter: cutoutGlow },
})
