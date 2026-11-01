import { style } from '../../zyzz.config.ts'
export { lede } from '../../Controls.styles.ts'

// Styles for adding pieces in View.ts (Gallery: add.html's scan step, before the found grid).
export const addPage = style({
  display: 'grid',
  gap: 'actions',
  maxInlineSize: '36rem',
  paddingBlock: '8px 48px',
  '@media (min-width: 900px)': { maxInlineSize: '56rem' },
})
export const pageBar = style({ display: 'flex', alignItems: 'center', gap: 'actions' })
/** The two ways that work best, as a short list above the ways in. */
export const guidance = style({ display: 'grid', gap: 'snug', marginBlockStart: '12px' })
export const guidanceTitle = style({ color: 'ink', fontSize: 'control', fontWeight: 600 })
export const guidanceList = style({
  display: 'grid',
  gap: 'snug',
  margin: '0',
  paddingInlineStart: '1.2em',
  color: 'ink2',
  fontSize: 'label',
})
/** The ways in: the library across the top, the camera's two ways side by side below it on a phone. */
export const sources = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 'related',
  marginBlockStart: '16px',
  '& > :first-child': { gridColumn: '1 / -1' },
  // On a wide screen the three ways in sit on one line.
  '@media (min-width: 900px)': {
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    '& > :first-child': { gridColumn: 'auto' },
  },
})
/** A source: a stock panel that is a label for its hidden file input, and takes dropped files. */
export const source = style({
  position: 'relative',
  display: 'grid',
  alignContent: 'center',
  justifyItems: 'center',
  gap: 'snug',
  minBlockSize: '148px',
  padding: '16px',
  borderWidth: '1.5px',
  // A dashed edge says "drop files here": only the photo picker, a label, takes dropped files; the camera's ways
  // are buttons with a solid edge.
  borderStyle: 'solid',
  borderColor: 'rule',
  '&:is(label)': { borderStyle: 'dashed' },
  borderRadius: 'panel',
  backgroundColor: 'stock',
  color: 'ink2',
  textAlign: 'center',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color, border-color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  '&[data-drag-over]': { borderColor: 'ink', backgroundColor: 'paper2' },
  // Hovered, its edge darkens, as Make's kinds do.
  '@media (hover: hover) and (pointer: fine)': { ':hover': { borderColor: 'ink3' } },
  // The file input inside is hidden, so the label shows its keyboard focus.
  '&:has(input:focus-visible)': {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: 'focus',
    outlineOffset: '2px',
  },
})
export const sourceIcons = style({ display: 'flex', gap: 'snug', color: 'ink', fontSize: 'iconLarge' })
export const sourceTitle = style({ color: 'ink', fontSize: 'control', fontWeight: 600, textWrap: 'balance' })
export const sourceHint = style({ fontSize: 'small' })
/** Add from a link: what it does, then the address and its Add button on one line. Its anchor clears the bar. */
export const linkForm = style({
  display: 'grid',
  gap: 'snug',
  marginBlockStart: '20px',
  scrollMarginBlockStart: '72px',
})
export const linkHint = style({ fontSize: 'small', color: 'ink2' })
export const linkRow = style({ display: 'flex', gap: 'actions', alignItems: 'center' })
export const problems = style({
  display: 'grid',
  gap: 'tight',
  marginBlockStart: '8px',
  fontSize: 'label',
  color: 'error',
})
/** The files on their way, one row each. */
export const queue = style({
  display: 'grid',
  marginBlockStart: '16px',
  padding: '0',
  listStyleType: 'none',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
})
export const queueRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 'related',
  minBlockSize: '56px',
  borderBlockEndWidth: '1px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'rule',
})
/** The queue's one-line summary, read out as it changes. */
export const summary = style({ marginBlockStart: '16px', fontSize: 'label', color: 'ink2' })
export const queueIcon = style({ display: 'inline-grid', color: 'ink2', fontSize: 'icon' })
export const queueName = style({
  flexGrow: 1,
  minInlineSize: '0',
  overflow: 'hidden',
  fontSize: 'label',
  fontWeight: 500,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})
export const queueState = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'snug',
  fontSize: 'small',
  color: 'signal',
  whiteSpace: 'nowrap',
})
export const queueDone = style({ fontSize: 'small', color: 'ink3' })
export const queueFailed = style({ fontSize: 'small', color: 'error', textAlign: 'end' })
export const retry = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  flex: 'none',
  padding: '0',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  cursor: 'pointer',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
})
export const review = style({ inlineSize: '100%', marginBlockStart: '24px' })
