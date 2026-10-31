import { style } from '../../zyzz.config.ts'

// A board's page (Gallery 2: docs/design/gallery-2/site/v2/board.html): its collage above the grid of its pins.
export const page = style({ display: 'grid', gap: '16px', paddingBlock: '8px 40px' })
/** The way back and the board's actions, kept to the collage's width on a wide screen, near what they act on. */
export const bar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  '@media (min-width: 900px)': { maxInlineSize: '560px' },
})
/** The page's own actions, at the end of the bar. */
export const barActions = style({ display: 'flex', alignItems: 'center', gap: '8px' })
export const back = style({ display: 'inline-flex', alignItems: 'center', gap: '4px', minBlockSize: '44px' })
export const head = style({ display: 'grid', gap: '4px' })
export const meta = style({ fontSize: '14px', color: 'ink2' })

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
  boxShadow: 'lift1',
  ':active': { transform: 'scale(0.98)' },
})
export const collageLabel = style({ paddingInline: '4px', fontSize: '14px', fontWeight: 600 })
/** With nothing on the table yet: a line and Make a collage, on stock after the pins. */
export const collageStart = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  maxInlineSize: '560px',
  paddingBlock: '12px',
  paddingInline: '16px 12px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
})
export const collageStartText = style({ flex: '1 1 14rem', fontSize: '14px', color: 'ink2', textWrap: 'pretty' })

export const pinsHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  '@media (min-width: 900px)': { maxInlineSize: '560px' },
})
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
  // One track the size of the frame, so a tall piece is fitted to the frame instead of cropped by it.
  gridTemplateColumns: 'minmax(0, 1fr)',
  gridTemplateRows: 'minmax(0, 1fr)',
  placeItems: 'center',
  aspectRatio: '1 / 1',
  overflow: 'hidden',
  borderRadius: 'panel',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  backgroundColor: 'paper',
})
export const cutout = style({
  inlineSize: '100%',
  blockSize: '100%',
  minInlineSize: '0',
  minBlockSize: '0',
  padding: '8px',
  objectFit: 'contain',
})
export const photo = style({
  inlineSize: '100%',
  blockSize: '100%',
  minInlineSize: '0',
  minBlockSize: '0',
  objectFit: 'cover',
  borderRadius: 'photo',
})
export const mosaic = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  inlineSize: '100%',
  blockSize: '100%',
  padding: '6px',
  '& img': { inlineSize: '100%', blockSize: '100%', minBlockSize: '0', objectFit: 'contain' },
})
export const pinName = style({ paddingInline: '4px', fontSize: '13px', fontWeight: 600 })
/** The unpin question over the tile: what happens, then Take off and Keep, full width. */
export const unpinAsk = style({
  position: 'absolute',
  inset: '0',
  display: 'grid',
  alignContent: 'end',
  gap: '8px',
  padding: '10px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  boxShadow: 'lift1',
  '& > button': { inlineSize: '100%' },
})
export const unpinQuestion = style({ fontSize: '13px', lineHeight: 1.4, color: 'ink', textWrap: 'pretty' })
/** Taking a pin off: a small round over the pin's corner. */
export const unpin = style({
  position: 'absolute',
  insetBlockStart: '0',
  insetInlineEnd: '0',
  display: 'grid',
  placeItems: 'center',
  // A 44px round (DESIGN.md › Controls › Round).
  inlineSize: '44px',
  blockSize: '44px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'stock',
  color: 'ink',
  cursor: 'pointer',
  boxShadow: 'overPhoto',
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
