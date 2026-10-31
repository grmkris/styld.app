import { style } from '../zyzz.config.ts'

// Styles for the review tray in ReviewView.ts (Gallery: add.html's found grid and footer action).
// The bottom padding clears the footer's band: its button and the nav pill under it.
export const reviewPage = style({
  display: 'grid',
  gap: '8px',
  paddingBlock: '8px 176px',
  '@media (min-width: 900px)': { paddingBlockEnd: '120px' },
})
export const pageBar = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' })
export const addMore = style({
  display: 'inline-flex',
  alignItems: 'center',
  minBlockSize: '44px',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 600,
  textDecorationLine: 'underline',
  textDecorationColor: 'signal',
  textUnderlineOffset: '4px',
})
export const lede = style({ color: 'ink2' })
export const allowance = style({ fontSize: '13px', color: 'ink3', fontVariantNumeric: 'tabular-nums' })
/** Found pieces: two columns on a phone, more on a wide screen. */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '12px 16px',
  marginBlockStart: '16px',
  padding: '0',
  listStyleType: 'none',
  '@media (min-width: 600px)': { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  '@media (min-width: 1000px)': { gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '16px 28px' },
})
export const found = style({ position: 'relative', display: 'grid', gap: '4px', margin: '0' })
export const foundImage = style({
  display: 'block',
  inlineSize: '100%',
  aspectRatio: '1 / 1',
  // Room inside the ring, so a piece never touches it.
  padding: '8px',
  objectFit: 'contain',
  borderRadius: 'panel',
  outlineWidth: '1px',
  outlineStyle: 'solid',
  outlineColor: 'rule',
  outlineOffset: '-1px',
  transitionProperty: 'opacity',
  transitionDuration: '160ms',
  // An unticked piece fades back, so what will be added stands out.
  '&[data-dropped]': { opacity: 0.45 },
})
/** A found piece's tile while the tray is read. */
export const foundSkeleton = style({
  display: 'block',
  inlineSize: '100%',
  aspectRatio: '1 / 1',
  borderRadius: 'panel',
})
/** The tick: a 44px target with a 28px dot, ink when kept and hollow when not (Gallery `.found .tick`). */
export const tick = style({
  position: 'absolute',
  insetBlockStart: '4px',
  insetInlineEnd: '4px',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  padding: '0',
  borderWidth: '0',
  backgroundColor: 'transparent !custom',
  color: 'transparent !custom',
  cursor: 'pointer',
  isolation: 'isolate',
  '::before': {
    content: '""',
    position: 'absolute',
    inset: '8px',
    zIndex: -1,
    borderRadius: 'pill',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: 'ink',
    backgroundColor: 'stock',
  },
  '&[aria-pressed="true"]': { color: 'onInk' },
  '&[aria-pressed="true"]::before': { backgroundColor: 'ink' },
})
export const caption = style({
  display: 'flex',
  alignItems: 'start',
  justifyContent: 'space-between',
  gap: '4px',
  minInlineSize: '0',
})
export const captionText = style({ display: 'grid', minInlineSize: '0', fontSize: '14px', fontWeight: 600 })
export const captionName = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
export const captionKind = style({ fontSize: '13px', fontWeight: 400, color: 'ink2' })
export const edit = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  flex: 'none',
  marginBlockStart: '-8px',
  marginInlineEnd: '-10px',
  padding: '0',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  color: 'ink2',
  cursor: 'pointer',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2', color: 'ink' } },
})
/** A capture still being cut out: a blank square that says so. */
export const pending = style({
  display: 'grid',
  placeItems: 'center',
  aspectRatio: '1 / 1',
  padding: '12px',
  borderRadius: 'panel',
  backgroundColor: 'paper2',
  color: 'signal',
  fontSize: '13px',
  textAlign: 'center',
})
export const pendingLabel = style({ display: 'inline-flex', alignItems: 'center', gap: '6px' })
/** A capture that needs the person: it failed, stopped halfway, or found nothing. */
export const notice = style({
  display: 'grid',
  gap: '8px',
  marginBlockStart: '12px',
  padding: '16px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  boxShadow: 'inset 0 0 0 1px #ddd6cc !custom',
  fontSize: '14px',
})
export const noticeActions = style({ display: 'flex', flexWrap: 'wrap', gap: '8px' })
/** The open piece: its picture large, then what it is. */
export const editor = style({ display: 'grid', gap: '8px', maxInlineSize: '36rem' })
export const editorImage = style({
  display: 'block',
  inlineSize: '100%',
  maxBlockSize: '360px',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'panel',
  boxShadow: 'inset 0 0 0 1px #ddd6cc !custom',
})
export const original = style({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  minBlockSize: '44px',
  marginBlockStart: '8px',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
})
/** The piece the wardrobe already has, small, with the hint to keep both. */
export const alreadyHave = style({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBlockStart: '8px',
  fontSize: '14px',
  color: 'ink2',
})
export const alreadyHaveImage = style({
  inlineSize: '64px',
  blockSize: '64px',
  flexShrink: 0,
  objectFit: 'contain',
  borderRadius: 'photo',
  backgroundColor: 'paper2',
})
/** How often the piece was seen, and the way to split it, under its picture. */
export const sightings = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '8px',
  marginBlockStart: '8px',
  fontSize: '14px',
  color: 'ink2',
})
/** The primary action stays in reach at the bottom of the screen (Gallery `.footer-cta`). On a phone its band runs
 * from the screen's edge, padded by the floating nav pill (16px from the edge, 64px tall, `View.styles.ts` › appNav),
 * so the button sits just above the pill and nothing shows between them. */
export const footer = style({
  position: 'fixed',
  insetInline: '0',
  insetBlockEnd: '0',
  zIndex: 4,
  display: 'grid',
  gap: '6px',
  paddingBlockStart: '12px',
  paddingBlockEnd: 'calc(96px + env(safe-area-inset-bottom))',
  paddingInline: 'max(16px, env(safe-area-inset-left))',
  '@media (min-width: 900px)': { paddingBlockEnd: 'max(16px, env(safe-area-inset-bottom))' },
  backgroundColor: 'paper',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
})
export const footerInner = style({
  display: 'grid',
  gap: '6px',
  inlineSize: '100%',
  maxInlineSize: '36rem',
  marginInline: 'auto',
})
export const wide = style({ inlineSize: '100%' })
