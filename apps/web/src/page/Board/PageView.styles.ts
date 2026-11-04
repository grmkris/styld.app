import { cutoutGlow, pressThenHover, style } from '../../zyzz.config.ts'
export { problem } from '../../Controls.styles.ts'

// A board's page (Gallery 2: docs/design/gallery-2/site/v2/board.html): its collage above the grid of its pins.
export const page = style({ display: 'grid', gap: 'grid', paddingBlock: '8px 40px' })
/** The way back and the board's actions, kept to the collage's width on a wide screen, near what they act on. */
export const bar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'actions',
})
/** The page's own actions, at the end of the bar. */
export const barActions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'actions' })
export const back = style({ display: 'inline-flex', alignItems: 'center', gap: 'tight', minBlockSize: '44px' })
export const head = style({ display: 'grid', gap: 'tight' })
export const meta = style({ fontSize: 'label', color: 'ink2' })

/** The collage as a card: the table on stock, opening the editor. */
export const collage = style({
  display: 'grid',
  gap: 'actions',
  maxInlineSize: '560px',
  padding: '8px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  color: 'ink',
  textDecorationLine: 'none',
  boxShadow: 'lift1',
  // The owner's card opens the editor: it presses and lifts. A visitor's collage is only a picture, and stays still.
  transitionProperty: 'transform, translate',
  transitionDuration: pressThenHover,
  transitionTimingFunction: 'standard',
  '&[href]:active': { transform: 'scale(0.98)' },
  '@media (hover: hover) and (pointer: fine)': { '&[href]:hover': { translate: '0 -2px' } },
})
export const pinsHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'actions',
  '@media (min-width: 900px)': { maxInlineSize: '560px' },
})
export const pinsTitle = style({ fontSize: 'subheading', fontWeight: 600 })
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))',
  gap: 'related',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
export const pin = style({ position: 'relative' })
/** A pin's picture: a cutout on paper, a picture with its own small corners, or a look's pieces in a square. */
export const pinLink = style({
  display: 'grid',
  gap: 'tight',
  color: 'ink',
  textDecorationLine: 'none',
  transitionProperty: 'transform, translate',
  transitionDuration: pressThenHover,
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.98)' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { translate: '0 -2px' } },
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
  // Its own group on its paper, so a photo's pale ground blends into the paper even while the link's press scales it.
  isolation: 'isolate',
})
export const cutout = style({
  inlineSize: '100%',
  blockSize: '100%',
  minInlineSize: '0',
  minBlockSize: '0',
  padding: '8px',
  objectFit: 'contain',
  mixBlendMode: 'darken',
  // DESIGN.md › Dark: no blend on the dark paper, where darken would sink a dark garment.
  '@media (prefers-color-scheme: dark)': { mixBlendMode: 'normal', filter: cutoutGlow },
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
  '& img': {
    inlineSize: '100%',
    blockSize: '100%',
    minBlockSize: '0',
    objectFit: 'contain',
    mixBlendMode: 'darken',
    '@media (prefers-color-scheme: dark)': { mixBlendMode: 'normal', filter: cutoutGlow },
  },
})
export const pinName = style({ paddingInline: '4px', fontSize: 'small', fontWeight: 600 })
/** Under a pin the board shows others without: a quiet line saying only its owner sees it. */
export const heldBack = style({ paddingInline: '4px', fontSize: 'small', color: 'ink2', textWrap: 'pretty' })
/** The unpin question over the tile: what happens, then Take off and Keep, full width. */
export const unpinAsk = style({
  position: 'absolute',
  inset: '0',
  display: 'grid',
  alignContent: 'end',
  gap: 'actions',
  padding: '10px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  boxShadow: 'lift1',
  '& > button': { inlineSize: '100%' },
})
export const unpinQuestion = style({ fontSize: 'small', lineHeight: 1.4, color: 'ink', textWrap: 'pretty' })
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
  transitionProperty: 'transform, background-color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
})
export const empty = style({ display: 'grid', gap: 'tight', color: 'ink2' })
export const emptyTitle = style({ fontWeight: 600, color: 'ink' })

/** The picker and the settings inside their sheets. */
export const sheetBody = style({
  display: 'grid',
  gap: 'related',
  maxBlockSize: '70dvh',
  overflowY: 'auto',
  paddingInline: '12px',
  paddingBlockEnd: '4px',
})
export const sheetSection = style({ fontSize: 'control', fontWeight: 600 })
export const pickGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
  gap: 'actions',
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
  transitionProperty: 'transform, background-color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-pressed="true"]': { borderColor: 'ink' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
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
export const actions = style({ display: 'flex', flexWrap: 'wrap', gap: 'actions' })
export const sharing = style({ display: 'grid', gap: 'snug', paddingBlockStart: '12px' })
export const moodsLabel = style({ margin: '0', fontSize: 'control', fontWeight: 600 })
export const moods = style({ display: 'flex', flexWrap: 'wrap', gap: 'snug' })
export const danger = style({
  display: 'grid',
  gap: 'actions',
  paddingBlockStart: '12px',
  color: 'ink2',
  fontSize: 'label',
})

/** The title, which renames the board when tapped: it reads as the heading, with a quiet pencil after it. */
export const titleButton = style({
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 'actions',
  maxInlineSize: '100%',
  padding: '0',
  borderWidth: '0',
  backgroundColor: 'transparent !custom',
  color: 'inherit !custom',
  font: 'inherit',
  letterSpacing: 'inherit',
  textAlign: 'start',
  cursor: 'text',
  '& > svg': { flex: 'none', inlineSize: '0.6em', blockSize: '0.6em', color: 'ink3' },
  '@media (hover: hover) and (pointer: fine)': { ':hover > svg': { color: 'ink' } },
})
/** The title as a field while it is renamed: the heading's size and weight, on a hairline. */
export const nameForm = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'actions' })
export const nameField = style({
  flex: '1 1 12ch',
  minInlineSize: '0',
  paddingBlock: '2px',
  paddingInline: '0',
  borderWidth: '0',
  borderBlockEnd: '1.5px solid',
  borderColor: 'ink',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  fontSize: 'title',
  fontWeight: 600,
  lineHeight: 1.08,
  letterSpacing: '-0.02em',
  outlineWidth: '0',
})
/** A row of the ⋯ sheet: an icon and what it does. */
export const moreRows = style({ display: 'grid', gap: 'tight', margin: '0', padding: '0', listStyle: 'none' })
export const moreRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 'related',
  inlineSize: '100%',
  minBlockSize: '48px',
  paddingInline: '12px',
  borderWidth: '0',
  borderRadius: 'field',
  backgroundColor: 'paper2',
  color: 'ink',
  fontSize: 'control',
  fontWeight: 500,
  textAlign: 'start',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  ':disabled': { color: 'ink3', cursor: 'default' },
  '@media (hover: hover) and (pointer: fine)': { ':hover:not(:disabled)': { backgroundColor: 'paper2Hover' } },
})
