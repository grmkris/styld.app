import { style } from './zyzz.config.ts'

/** The one ink-filled action a screen may have (DESIGN.md › Controls). Works on links and buttons. */
export const primaryAction = style({
  display: 'inline-flex',
  alignItems: 'center',
  minBlockSize: '48px',
  backgroundColor: 'ink',
  color: 'paper',
  padding: '0.65rem 1.5rem',
  border: '0',
  borderRadius: 'control',
  textDecoration: 'none',
  cursor: 'pointer',
  ':active': { opacity: 0.8 },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { opacity: 0.85 } },
})

export const secondaryAction = style({
  display: 'inline-flex',
  alignItems: 'center',
  minBlockSize: '48px',
  padding: '0.65rem 1.5rem',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'control',
  // Also used on buttons, which bring their own background and colour.
  backgroundColor: 'transparent !custom',
  color: 'inherit !custom',
  cursor: 'pointer',
  ':active': { opacity: 0.8 },
  '@media (hover: hover) and (pointer: fine)': {
    ':hover': { backgroundColor: 'hover' },
  },
})
