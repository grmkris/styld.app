import { style } from '../../zyzz.config.ts'

// Styles for adding pieces in View.ts (Gallery: add.html's scan step, before the found grid).
export const addPage = style({ display: 'grid', gap: '8px', maxInlineSize: '36rem', paddingBlock: '8px 48px' })
export const pageBar = style({ display: 'flex', alignItems: 'center', gap: '8px' })
export const lede = style({ color: 'ink2' })
/** The two ways in, side by side on a phone: the library and the camera. */
export const sources = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '12px',
  marginBlockStart: '16px',
})
/** A source: a stock panel that is a label for its hidden file input, and takes dropped files. */
export const source = style({
  position: 'relative',
  display: 'grid',
  alignContent: 'center',
  justifyItems: 'center',
  gap: '6px',
  minBlockSize: '148px',
  padding: '16px',
  borderWidth: '1.5px',
  borderStyle: 'dashed',
  borderColor: 'rule',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  color: 'ink2',
  textAlign: 'center',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.98)' },
  '&[data-drag-over]': { borderColor: 'ink', backgroundColor: 'paper2' },
  // The file input inside is hidden, so the label shows its keyboard focus.
  '&:has(input:focus-visible)': {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: 'focus',
    outlineOffset: '2px',
  },
})
export const sourceIcons = style({ display: 'flex', gap: '6px', color: 'ink', fontSize: '24px' })
export const sourceTitle = style({ color: 'ink', fontSize: '15px', fontWeight: 600, textWrap: 'balance' })
export const sourceHint = style({ fontSize: '13px' })
export const problems = style({
  display: 'grid',
  gap: '4px',
  marginBlockStart: '8px',
  fontSize: '14px',
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
  gap: '12px',
  minBlockSize: '56px',
  borderBlockEndWidth: '1px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'rule',
})
/** The queue's one-line summary, read out as it changes. */
export const summary = style({ marginBlockStart: '16px', fontSize: '14px', color: 'ink2' })
export const queueIcon = style({ display: 'inline-grid', color: 'ink2', fontSize: '20px' })
export const queueName = style({
  flexGrow: 1,
  minInlineSize: '0',
  overflow: 'hidden',
  fontSize: '14px',
  fontWeight: 500,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})
export const queueState = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '13px',
  color: 'signal',
  whiteSpace: 'nowrap',
})
export const queueDone = style({ fontSize: '13px', color: 'ink3' })
export const queueFailed = style({ fontSize: '13px', color: 'error', textAlign: 'end' })
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
