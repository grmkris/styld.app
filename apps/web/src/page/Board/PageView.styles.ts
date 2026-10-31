import { style } from '../../zyzz.config.ts'

// A board's page (Gallery 2: docs/design/gallery-2/site/v2/board.html): its collage above the grid of its pins.
export const page = style({ display: 'grid', gap: '16px', paddingBlock: '8px 40px' })
export const bar = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' })
/** The page's own actions, at the end of the bar. */
export const barActions = style({ display: 'flex', alignItems: 'center', gap: '4px' })
export const back = style({ display: 'inline-flex', alignItems: 'center', gap: '4px', minBlockSize: '44px' })
export const head = style({ display: 'grid', gap: '4px' })
export const meta = style({ fontSize: '14px', color: 'ink2' })
export const round = style({
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  inlineSize: '44px',
  blockSize: '44px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  cursor: 'pointer',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
  ':active': { transform: 'scale(0.96)' },
})

/** The collage as a card: the table on stock, opening the editor. */
export const collage = style({
  display: 'grid',
  gap: '8px',
  maxInlineSize: '560px',
  padding: '8px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  color: 'ink',
  textDecorationLine: 'none',
  boxShadow: '0 1px 2px oklch(0 0 0 / 0.05), 0 8px 24px oklch(0 0 0 / 0.05) !custom',
  ':active': { transform: 'scale(0.98)' },
})
export const collageLabel = style({ paddingInline: '4px', fontSize: '14px', fontWeight: 600 })
export const collageEmpty = style({
  display: 'grid',
  placeContent: 'center',
  gap: '8px',
  aspectRatio: '4 / 5',
  padding: '24px',
  borderRadius: 'table',
  backgroundColor: 'paper',
  color: 'ink2',
  textAlign: 'center',
})

export const pinsHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' })
export const pinsTitle = style({ fontSize: '17px', fontWeight: 600 })
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))',
  gap: '12px',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
export const pin = style({ position: 'relative' })
/** A pin's picture: a cutout on paper, a picture with its own small corners, or a look's pieces in a square. */
export const pinLink = style({
  display: 'grid',
  gap: '4px',
  color: 'ink',
  textDecorationLine: 'none',
  ':active': { transform: 'scale(0.98)' },
})
export const pinFrame = style({
  display: 'grid',
  placeItems: 'center',
  aspectRatio: '1 / 1',
  overflow: 'hidden',
  borderRadius: 'panel',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  backgroundColor: 'paper',
})
export const cutout = style({ inlineSize: '100%', blockSize: '100%', padding: '8px', objectFit: 'contain' })
export const photo = style({ inlineSize: '100%', blockSize: '100%', objectFit: 'cover', borderRadius: 'photo' })
export const mosaic = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  inlineSize: '100%',
  blockSize: '100%',
  padding: '6px',
  '& img': { inlineSize: '100%', blockSize: '100%', minBlockSize: '0', objectFit: 'contain' },
})
export const pinName = style({ paddingInline: '4px', fontSize: '13px', fontWeight: 600 })
/** Taking a pin off: a small round over the pin's corner. */
export const unpin = style({
  position: 'absolute',
  insetBlockStart: '4px',
  insetInlineEnd: '4px',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '36px',
  blockSize: '36px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'stock',
  color: 'ink',
  cursor: 'pointer',
  boxShadow: '0 1px 4px oklch(0 0 0 / 0.12) !custom',
})
export const empty = style({ display: 'grid', gap: '4px', color: 'ink2' })
export const emptyTitle = style({ fontWeight: 600, color: 'ink' })
export const problem = style({ fontSize: '14px', color: 'error' })

/** The picker and the settings inside their sheets. */
export const sheetBody = style({
  display: 'grid',
  gap: '12px',
  maxBlockSize: '70dvh',
  overflowY: 'auto',
  paddingInline: '12px',
  paddingBlockEnd: '4px',
})
export const sheetSection = style({ fontSize: '15px', fontWeight: 600 })
export const pickGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
  gap: '8px',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
export const pick = style({
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '100%',
  aspectRatio: '1 / 1',
  padding: '6px',
  borderWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'transparent !custom',
  borderRadius: 'panel',
  backgroundColor: 'paper',
  cursor: 'pointer',
  '&[aria-pressed="true"]': { borderColor: 'ink' },
})
export const picked = style({
  position: 'absolute',
  insetBlockStart: '4px',
  insetInlineEnd: '4px',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '24px',
  blockSize: '24px',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
})
export const field = style({ display: 'grid', gap: '6px', fontSize: '14px', fontWeight: 600 })
export const actions = style({ display: 'flex', flexWrap: 'wrap', gap: '8px' })
export const sharing = style({ display: 'grid', gap: '6px', paddingBlockStart: '12px' })
export const moodsLabel = style({ margin: '0', fontSize: '15px', fontWeight: 600 })
export const moods = style({ display: 'flex', flexWrap: 'wrap', gap: '6px' })
export const danger = style({ display: 'grid', gap: '8px', paddingBlockStart: '12px', color: 'ink2', fontSize: '14px' })
