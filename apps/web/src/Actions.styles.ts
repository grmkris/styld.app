import { style } from './zyzz.config.ts'

/** The one ink-filled pill action a screen may have (DESIGN.md › Controls). Works on links and buttons. */
export const primaryAction = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  minBlockSize: '48px',
  paddingInline: '20px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
  fontSize: '15px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  textDecorationLine: 'none',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'inkHover' } },
  '&[data-disabled]': { opacity: 0.5, cursor: 'not-allowed' },
})

/** The outlined pill beside a primary action: the same shape, a 1.5px ink ring, no fill. */
export const secondaryAction = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  minBlockSize: '48px',
  paddingInline: '20px',
  borderWidth: '1.5px',
  borderStyle: 'solid',
  borderColor: 'ink',
  borderRadius: 'pill',
  // Also used on buttons, which bring their own background.
  backgroundColor: 'transparent !custom',
  color: 'ink',
  fontSize: '15px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  textDecorationLine: 'none',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
  '&[data-disabled]': { opacity: 0.5, cursor: 'not-allowed' },
})

/** The Small size (DESIGN.md › Controls): 40px tall, 16px sides, 14px, with the touch target kept at 44px. Combine
 * with primaryAction or secondaryAction. */
export const smallAction = style({
  position: 'relative',
  minBlockSize: '40px',
  paddingInline: '16px',
  fontSize: '14px',
  '::after': { content: '""', position: 'absolute', insetInline: '0', insetBlock: '-2px' },
})
