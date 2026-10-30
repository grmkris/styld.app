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
/** The clean picture's panel: what it is, where it stands and what the owner can do with it. */
export const picturePanel = style({ display: 'grid', gap: '8px', marginBlockStart: '8px' })
export const cleanedLabel = style({ fontSize: '13px', fontWeight: 500, color: 'ink3' })
export const pictureNote = style({ fontSize: '14px', color: 'ink2' })
export const proposal = style({ display: 'flex', alignItems: 'center', gap: '12px' })
export const proposalImage = style({
  inlineSize: '88px',
  blockSize: '88px',
  objectFit: 'contain',
  borderRadius: 'photo',
  backgroundColor: 'stock',
})
/** The turn's player: the picture itself is the button that turns it. */
export const turnButton = style({
  display: 'block',
  padding: '0',
  borderWidth: '0',
  backgroundColor: 'transparent !custom',
  cursor: 'pointer',
  touchAction: 'manipulation',
})
/** The still and the turn's player in one place, the player on top: until the player draws, the still shows. */
export const turnStack = style({ display: 'grid', '& > *': { gridArea: '1 / 1' } })
