import { cutoutGlow, style } from '../zyzz.config.ts'

// Styles for Select mode on the wardrobe's grid in WardrobeSelectView.ts: ticks as the board's picker draws them
// (Board/PageView.styles.ts `pick`), and a bar that stays above the floating tab bar.

/** The ticks and their bar: the bar sticks to the bottom while the grid is in view. */
export const selecting = style({ display: 'grid', gap: 'related' })
/** The grid's tiles, spaced as the links they stand in for. */
export const tickGrid = style({ margin: '0' })
/** A piece as a tick: a pressed one is ringed in ink. */
export const tick = style({
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '100%',
  padding: '4px',
  borderWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'transparent !custom',
  borderRadius: 'panel',
  backgroundColor: 'paper',
  cursor: 'pointer',
  transitionProperty: 'transform, border-color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-pressed="true"]': { borderColor: 'ink' },
})
export const tickImage = style({
  display: 'block',
  inlineSize: '100%',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'photo',
  // As the grid's cut-outs (WardrobeView.styles.ts `cutImage`; DESIGN.md › Dark).
  mixBlendMode: 'darken',
  '@media (prefers-color-scheme: dark)': { mixBlendMode: 'normal', filter: cutoutGlow },
})
/** The check over a ticked piece's corner. */
export const ticked = style({
  position: 'absolute',
  insetBlockStart: '6px',
  insetInlineEnd: '6px',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '24px',
  blockSize: '24px',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
})
/** Delete and Done, or the question, on stock above the phone's floating tab bar; on a wide screen at the bottom. */
export const bar = style({
  position: 'sticky',
  insetBlockEnd: 'calc(100px + env(safe-area-inset-bottom))',
  zIndex: 2,
  display: 'grid',
  gap: 'related',
  padding: '14px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  boxShadow: 'lift1',
  '@media (min-width: 900px)': { insetBlockEnd: '24px' },
})
export const barActions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'actions' })
export const hint = style({ margin: '0', fontSize: 'label', color: 'ink2' })
export const question = style({ margin: '0', fontSize: 'control', color: 'ink' })
