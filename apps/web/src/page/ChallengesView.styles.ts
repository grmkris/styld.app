import { style } from '../zyzz.config.ts'

// Challenges, coming soon: three quiet cards in a row on the board papers' tints, under a head with a "Coming soon"
// chip. They are not controls, so they take no press, hover or focus.

export const section = style({ display: 'grid', gap: 'related', minInlineSize: '0' })
export const head = style({ display: 'flex', alignItems: 'center', gap: 'actions' })
export const title = style({ margin: '0', fontSize: 'heading', fontWeight: 600 })
export const soon = style({
  paddingInline: '10px',
  paddingBlock: '4px',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink2',
  fontSize: 'small',
  fontWeight: 500,
})
export const row = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 'related',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
export const card = style({
  display: 'grid',
  alignItems: 'end',
  aspectRatio: '1 / 1',
  padding: '12px',
  borderRadius: 'panel',
  color: 'ink2',
  fontSize: 'label',
  fontWeight: 600,
  textWrap: 'balance',
  '&[data-tint="clay"]': { backgroundColor: 'tintClay' },
  '&[data-tint="slate"]': { backgroundColor: 'tintSlate' },
  '&[data-tint="sage"]': { backgroundColor: 'tintSage' },
})
