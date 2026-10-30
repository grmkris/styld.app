import { style } from '../zyzz.config.ts'

// A person's profile and a piece's page as others see them (Gallery 2: docs/design/gallery-2/site/v2/person.html).
export const page = style({ display: 'grid', gap: '16px', paddingBlock: '8px 40px' })
export const person = style({ display: 'grid', justifyItems: 'start', gap: '6px' })
export const name = style({ margin: '0', fontSize: '28px', lineHeight: 1.1 })
export const handle = style({ margin: '0', fontSize: '14px', color: 'ink2' })
export const bio = style({ margin: '0', maxInlineSize: '42ch' })
export const tabs = style({
  display: 'flex',
  gap: '4px',
  borderBlockEndWidth: '1px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'rule',
})
export const tab = style({
  minBlockSize: '44px',
  paddingInline: '12px',
  borderWidth: '0',
  borderBlockEndWidth: '2px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'transparent !custom',
  backgroundColor: 'transparent !custom',
  color: 'ink2',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
  '&[aria-pressed="true"]': { color: 'ink', borderBlockEndColor: 'ink' },
})
export const boards = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
  gap: '16px',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
export const empty = style({ color: 'ink2' })
export const pieceImage = style({
  inlineSize: '100%',
  maxInlineSize: '420px',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'panel',
  backgroundColor: 'paper',
})
