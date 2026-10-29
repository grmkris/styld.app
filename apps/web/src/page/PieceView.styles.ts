import { style } from '../zyzz.config.ts'

// Styles for a piece you own in PieceView.ts (Gallery: item.html, item-desktop.html).
export const piecePage = style({
  display: 'grid',
  gap: '16px',
  paddingBlock: '8px 40px',
  '@media (min-width: 900px)': {
    gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
    alignItems: 'start',
    columnGap: '48px',
  },
})
export const pageBar = style({ display: 'flex', alignItems: 'center', gap: '8px', gridColumn: '1 / -1' })
/** A 44px round icon action (Gallery `.round`). */
export const round = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  padding: '0',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  cursor: 'pointer',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
})
export const photo = style({
  display: 'block',
  inlineSize: '100%',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'photo',
  '@media (min-width: 900px)': { aspectRatio: 'auto', blockSize: 'min(640px, 70vh)' },
})
export const details = style({ display: 'grid', gap: '8px', alignContent: 'start', maxInlineSize: '30rem' })
export const pieceName = style({ fontSize: '26px', lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.02em' })
export const meta = style({ color: 'ink2' })
export const actions = style({ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBlock: '12px' })
export const facts = style({ display: 'grid', marginBlockStart: '8px' })
export const fact = style({
  display: 'grid',
  gridTemplateColumns: '96px minmax(0, 1fr)',
  paddingBlock: '12px',
  borderBlockEndWidth: '1px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'rule',
})
export const factTerm = style({ color: 'ink2' })
export const factValue = style({ overflowWrap: 'anywhere', whiteSpace: 'pre-line' })
/** The delete confirmation: a stock panel in the page, not a dialog. */
export const confirm = style({
  display: 'grid',
  gap: '12px',
  padding: '20px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
})
export const confirmTitle = style({ fontSize: '17px', fontWeight: 600 })
export const editForm = style({ display: 'grid', gap: '4px' })
export const notesField = style({
  inlineSize: '100%',
  minBlockSize: '120px',
  padding: '14px 16px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'field',
  backgroundColor: 'stock',
  color: 'ink',
  fontSize: '16px',
  resize: 'vertical',
})
export const status = style({ display: 'flex', alignItems: 'center', gap: '8px', color: 'signal' })
