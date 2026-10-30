import { style } from '../zyzz.config.ts'

// The profile editor: who you are to others, and whether they can see it.
export const page = style({ display: 'grid', gap: '24px', maxInlineSize: '36rem', paddingBlock: '8px 40px' })
export const who = style({ display: 'flex', alignItems: 'center', gap: '16px' })
export const form = style({ display: 'grid', gap: '16px' })
export const field = style({ display: 'grid', gap: '6px', fontSize: '14px', fontWeight: 600 })
export const hint = style({ fontSize: '13px', fontWeight: 400, color: 'ink3' })
export const handleRow = style({ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '16px', fontWeight: 400 })
export const tones = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  margin: '0',
  padding: '0',
  borderWidth: '0',
})
export const tone = style({
  inlineSize: '44px',
  blockSize: '44px',
  padding: '0',
  borderWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'transparent !custom',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  cursor: 'pointer',
  '&[aria-checked="true"]': { borderColor: 'ink' },
})
export const check = style({ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' })
export const actions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' })
export const note = style({ fontSize: '14px', color: 'ink2' })
export const problem = style({ fontSize: '14px', color: 'error' })
export const publicCard = style({
  display: 'grid',
  gap: '8px',
  padding: '16px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
})
