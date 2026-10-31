import { keyframes } from 'zyzz/web'
import { style } from '../../zyzz.config.ts'

// The board editor (Gallery 2: docs/design/gallery-2, the canvas spike in docs/design/canvas-spike).

const itemOut = keyframes({ to: { opacity: 0, transform: 'scale(0.86)' } }, { id: 'styld-board-item-out' })

export const page = style({ display: 'grid', gap: '16px', paddingBlock: '8px 32px' })
export const header = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' })
export const back = style({ display: 'inline-flex', alignItems: 'center', gap: '4px', minBlockSize: '44px' })
export const title = style({ flex: '1 1 12rem', minInlineSize: '0' })
export const status = style({ fontSize: '13px', color: 'ink3', '&[data-tone="error"]': { color: 'error' } })

export const stage = style({
  display: 'grid',
  gap: '12px',
  '& > *': { minInlineSize: '0' },
  '@media (min-width: 900px)': {
    gridTemplateColumns: 'minmax(0, 560px) minmax(0, 1fr)',
    alignItems: 'start',
    columnGap: '40px',
    '& > *': { gridColumn: '1' },
    '& > [data-tray]': { gridColumn: '2', gridRow: '1 / span 8' },
  },
})

export const tools = style({ display: 'flex', flexWrap: 'wrap', gap: '8px' })
export const tool = style({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  minBlockSize: '40px',
  paddingInline: '14px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  transitionProperty: 'transform, background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-disabled="true"]': { opacity: 0.5, cursor: 'not-allowed' },
  // A 40px pill with a 44px target.
  '::after': { content: '""', position: 'absolute', insetInline: '0', insetBlock: '-2px' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2Hover' } },
})

/** The table: a 4:5 sheet whose width is 1000 units, so one unit is 0.1cqw. Items are placed by custom
 * properties the browser sets (`--x`, `--y`, `--k`, `--r`, `--flip`); the edge CSP allows no inline styles,
 * so a table only renders after its data loads in the browser. */
export const paper = style({
  position: 'relative',
  // The table's own stacking: a piece's place in the pile never lifts it over the page's sheets.
  isolation: 'isolate',
  aspectRatio: '4 / 5',
  containerType: 'inline-size',
  overflow: 'hidden',
  borderRadius: 'table',
  backgroundColor: 'paper',
  boxShadow: 'inset 0 0 0 1px #ddd6cc !custom',
  touchAction: 'pan-y',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  '&[data-paper="stock"]': { backgroundColor: 'stock' },
  '&[data-paper="sand"]': { backgroundColor: 'tintSand' },
  '&[data-paper="sage"]': { backgroundColor: 'tintSage' },
  '&[data-paper="slate"]': { backgroundColor: 'tintSlate' },
  '&[data-paper="clay"]': { backgroundColor: 'tintClay' },
  '&[data-dropping]': { boxShadow: 'inset 0 0 0 2px #2f4f7c !custom' },
})
/** A table with no hands on it: a board's preview or Home's outfit. */
export const still = style({ touchAction: 'auto', pointerEvents: 'none' })
export const emptyHint = style({
  position: 'absolute',
  insetInline: '12%',
  insetBlockStart: '42%',
  margin: '0',
  textAlign: 'center',
  color: 'ink2',
  pointerEvents: 'none',
})
export const dropHint = style({
  position: 'absolute',
  insetBlockEnd: '16px',
  insetInline: '16px',
  zIndex: 10000,
  paddingBlock: '10px',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
  fontSize: '14px',
  fontWeight: 600,
  textAlign: 'center',
  pointerEvents: 'none',
})

export const item = style({
  position: 'absolute',
  insetInlineStart: '0',
  insetBlockStart: '0',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '40cqw',
  translate: 'calc(var(--x) * 0.1cqw - 50%) calc(var(--y) * 0.1cqw - 50%)',
  rotate: 'var(--r)',
  scale: 'calc(var(--k) * var(--flip)) var(--k)',
  borderRadius: 'photo',
  touchAction: 'none',
  cursor: 'grab',
  WebkitTouchCallout: 'none',
  transitionProperty: 'translate, rotate, scale',
  transitionDuration: '560ms',
  transitionTimingFunction: 'var(--styld-spring)',
  ':focus-visible': { outlineWidth: 'calc(2px / var(--k)) !custom', outlineOffset: 'calc(4px / var(--k)) !custom' },
  '&[data-held]': { cursor: 'grabbing', transitionProperty: 'none' },
  '&[data-selected]::after': {
    content: '""',
    position: 'absolute',
    inset: 'calc(-6px / var(--k)) !custom',
    borderWidth: 'calc(1.5px / var(--k)) !custom',
    borderStyle: 'dashed',
    borderColor: 'ink',
    borderRadius: 'calc(10px / var(--k)) !custom',
    pointerEvents: 'none',
  },
  '&[data-leaving]': {
    pointerEvents: 'none',
    animationName: itemOut,
    animationDuration: '240ms',
    animationTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
    animationFillMode: 'forwards',
  },
})
export const square = style({ aspectRatio: '1 / 1' })
/** A label's frame fits its words, up to most of the table's width. */
export const words = style({ inlineSize: 'max-content', maxInlineSize: '90cqw' })
/** A piece fills its square frame and fits inside it, however tall: out of the flow, so it cannot size the frame. */
export const cutout = style({
  position: 'absolute',
  inset: '0',
  display: 'block',
  inlineSize: '100%',
  blockSize: '100%',
  objectFit: 'contain',
  pointerEvents: 'none',
  WebkitUserDrag: 'none',
})
export const picture = style({
  display: 'block',
  inlineSize: '100%',
  blockSize: 'auto',
  borderRadius: 'photo',
  pointerEvents: 'none',
  WebkitUserDrag: 'none',
})
export const label = style({
  inlineSize: 'max-content',
  maxInlineSize: '90cqw',
  paddingInline: '2cqw',
  fontSize: '7cqw',
  fontWeight: 600,
  lineHeight: 1.15,
  color: 'ink',
  textAlign: 'center',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  '&[data-style="headline"]': {
    fontFamily: 'voice',
    fontSize: '12cqw',
    fontWeight: 400,
    lineHeight: 0.95,
    letterSpacing: '0.005em',
  },
})
/** The corner: 44px to grab and a 26px ink dot to see, the same size however the item is scaled. */
export const handle = style({
  position: 'absolute',
  insetInlineEnd: '0',
  insetBlockEnd: '0',
  inlineSize: '44px',
  blockSize: '44px',
  translate: '50% 50%',
  scale: 'calc(1 / var(--k)) !custom',
  touchAction: 'none',
  cursor: 'nwse-resize',
  '::before': {
    content: '""',
    position: 'absolute',
    inset: '9px',
    borderRadius: 'pill',
    backgroundColor: 'ink',
    boxShadow: '0 0 0 3px #f1eee7 !custom',
  },
})

export const selection = style({
  display: 'grid',
  gap: '10px',
  padding: '12px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  boxShadow: '0 1px 2px oklch(0 0 0 / 0.05), 0 8px 24px oklch(0 0 0 / 0.05) !custom',
})
export const editor = style({ display: 'grid', gap: '8px' })
export const selectionRow = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' })
export const field = style({
  inlineSize: '100%',
  minBlockSize: '52px',
  padding: '12px 14px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'field',
  backgroundColor: 'stock',
  resize: 'vertical',
})
export const choices = style({ display: 'flex', flexWrap: 'wrap', gap: '8px' })
export const choice = style({
  minBlockSize: '36px',
  paddingInline: '14px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink2',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  '&[aria-pressed="true"]': { backgroundColor: 'ink', color: 'onInk' },
})
export const swatch = style({
  position: 'relative',
  inlineSize: '36px',
  blockSize: '36px',
  minBlockSize: '36px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'pill',
  backgroundColor: 'paper',
  cursor: 'pointer',
  '&[data-paper="stock"]': { backgroundColor: 'stock' },
  '&[data-paper="sand"]': { backgroundColor: 'tintSand' },
  '&[data-paper="sage"]': { backgroundColor: 'tintSage' },
  '&[data-paper="slate"]': { backgroundColor: 'tintSlate' },
  '&[data-paper="clay"]': { backgroundColor: 'tintClay' },
  // A 36px circle with a 44px target, 8px apart so the targets never overlap.
  '::after': { content: '""', position: 'absolute', inset: '-4px' },
  '&[aria-pressed="true"]': { outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'ink', outlineOffset: '2px' },
})

export const toast = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  paddingBlock: '8px',
  paddingInline: '16px 8px',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
  fontSize: '14px',
})
export const toastAction = style({
  minBlockSize: '36px',
  paddingInline: '14px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  color: 'onInk',
  fontWeight: 700,
  cursor: 'pointer',
})
export const fine = style({ fontSize: '13px', color: 'ink3' })

export const tray = style({
  display: 'grid',
  gap: '8px',
  '& h2': { fontSize: '15px', fontWeight: 600 },
  '@media (min-width: 900px)': {
    position: 'sticky',
    insetBlockStart: '24px',
    gap: '12px',
    '& h2': { fontSize: '22px' },
  },
})
/** One scrolling row of pieces on a phone; a grid beside the table on a desktop. */
export const trayList = style({
  display: 'flex',
  gap: '8px',
  margin: '0',
  marginInline: 'calc(-1 * max(20px, env(safe-area-inset-left)))',
  paddingInline: 'max(20px, env(safe-area-inset-left))',
  paddingBlockEnd: '4px',
  overflowX: 'auto',
  scrollSnapType: 'x proximity',
  listStyle: 'none',
  '& > li': { flex: '0 0 76px', scrollSnapAlign: 'start' },
  '@media (min-width: 900px)': {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
    marginInline: '0',
    paddingInline: '0',
    overflowX: 'visible',
    '& > li': { flex: 'none' },
  },
})
export const trayPiece = style({
  display: 'grid',
  // One track the size of the tile, so a tall piece is fitted to the tile instead of growing it.
  gridTemplateColumns: 'minmax(0, 1fr)',
  gridTemplateRows: 'minmax(0, 1fr)',
  placeItems: 'center',
  inlineSize: '100%',
  minBlockSize: '0',
  aspectRatio: '1 / 1',
  padding: '6px',
  borderWidth: '0',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  cursor: 'pointer',
  transitionProperty: 'transform, box-shadow',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-pressed="true"]': { boxShadow: 'inset 0 0 0 1.5px #1c1410 !custom' },
})
export const trayImage = style({
  inlineSize: '100%',
  blockSize: '100%',
  minInlineSize: '0',
  minBlockSize: '0',
  objectFit: 'contain',
  pointerEvents: 'none',
})
