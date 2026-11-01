import { style } from '../zyzz.config.ts'
export { note, problem } from '../Controls.styles.ts'

// "Save to board" (v1's save-to-board sheet in Gallery 2's sheet): the person's boards, and a new one by name.
export const body = style({
  display: 'grid',
  gap: 'related',
  maxBlockSize: '70dvh',
  overflowY: 'auto',
  paddingInline: '12px',
  paddingBlockEnd: '4px',
})
export const section = style({ fontSize: 'control', fontWeight: 600 })
export const list = style({ display: 'grid', gap: 'tight', margin: '0', padding: '0', listStyle: 'none' })
export const board = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'related',
  inlineSize: '100%',
  minBlockSize: '52px',
  paddingInline: '12px',
  borderWidth: '0',
  borderRadius: 'panel',
  backgroundColor: 'paper',
  color: 'ink',
  fontSize: 'control',
  fontWeight: 600,
  textAlign: 'start',
  cursor: 'pointer',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
  ':active': { transform: 'scale(0.98)' },
})
export const count = style({ fontSize: 'small', fontWeight: 400, color: 'ink3' })
export const create = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 'actions' })
export const field = style({ display: 'grid', gap: 'snug', flex: '1 1 12rem', fontSize: 'label', fontWeight: 600 })
