import { style } from '../zyzz.config.ts'

export const sharing = style({ display: 'grid', gap: '6px', paddingBlockStart: '12px' })
export const toggle = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  minBlockSize: '44px',
  fontSize: '15px',
  fontWeight: 600,
})
export const meta = style({ fontSize: '14px', color: 'ink2' })
export const problem = style({ fontSize: '14px', color: 'error' })
