import { style } from '../zyzz.config.ts'

export const sharing = style({ display: 'grid', gap: '6px', paddingBlockStart: '12px' })
/** The switch's row: its name (and who sees it) at the start, the track at the end, 44px tall. */
export const toggle = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  minBlockSize: '44px',
})
export const toggleText = style({ display: 'grid', gap: '2px' })
export const toggleLabel = style({ fontSize: '15px', fontWeight: 600, cursor: 'pointer' })
/** A pill track: paper-2 off, ink on; the thumb slides across on Gallery's curve. A 44px target over the 32px pill. */
export const track = style({
  position: 'relative',
  flex: 'none',
  inlineSize: '52px',
  blockSize: '32px',
  padding: '4px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  cursor: 'pointer',
  transitionProperty: 'background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  '::after': { content: '""', position: 'absolute', insetInline: '-4px', insetBlock: '-6px' },
  '&[data-checked]': { backgroundColor: 'ink' },
  '&[data-disabled]': { opacity: 0.5, cursor: 'not-allowed' },
  '&[data-checked] > span': { transform: 'translateX(20px)' },
})
export const thumb = style({
  display: 'block',
  inlineSize: '24px',
  blockSize: '24px',
  borderRadius: 'pill',
  backgroundColor: 'stock',
  boxShadow: 'lift1',
  transitionProperty: 'transform',
  transitionDuration: '180ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0ms' },
})
export const meta = style({ fontSize: '14px', color: 'ink2' })
export const problem = style({ fontSize: '14px', color: 'error' })
