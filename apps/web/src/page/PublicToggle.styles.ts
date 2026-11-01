import { style } from '../zyzz.config.ts'
export { problem } from '../Controls.styles.ts'

export const sharing = style({ display: 'grid', gap: 'snug', paddingBlockStart: '12px' })
/** The switch's row: its name (and who sees it) at the start, the track at the end, 44px tall. */
export const toggle = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'grid',
  minBlockSize: '44px',
})
export const toggleText = style({ display: 'grid', gap: 'hairline' })
export const toggleLabel = style({ fontSize: 'control', fontWeight: 600, cursor: 'pointer' })
/** A pill track: paper-2 off, ink on; the thumb slides across on Gallery's curve. A 44px target over the 32px pill. */
export const track = style({
  position: 'relative',
  flex: 'none',
  inlineSize: '52px',
  blockSize: '32px',
  // The page's controls are 44px tall; the pill stays 32px and its ::after keeps the 44px target.
  minBlockSize: '32px',
  padding: '4px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  boxShadow: 'switchEdge',
  cursor: 'pointer',
  transitionProperty: 'background-color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  '::after': { content: '""', position: 'absolute', insetInline: '-4px', insetBlock: '-6px' },
  '&[data-checked]': { backgroundColor: 'ink', boxShadow: 'none !custom' },
  '&[data-disabled]': { opacity: 0.5, cursor: 'not-allowed' },
  '&[data-checked] > span': { transform: 'translateX(20px)', backgroundColor: 'onInk' },
})
export const thumb = style({
  display: 'block',
  inlineSize: '24px',
  blockSize: '24px',
  borderRadius: 'pill',
  backgroundColor: 'ink3',
  transitionProperty: 'transform, background-color',
  transitionDuration: 'hover',
  transitionTimingFunction: 'standard',
  '@media (prefers-reduced-motion: reduce)': { transitionDuration: 'instant' },
})
export const meta = style({ fontSize: 'label', color: 'ink2' })
