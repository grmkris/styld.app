import { style } from '../zyzz.config.ts'

export { chip, chosen } from '../Controls.styles.ts'

// The first run: the whole screen on paper, a column of at most 34rem in its middle, the step's question at its top,
// its choices under it and the actions at its foot.

export const screen = style({
  inlineSize: '100vw',
  blockSize: '100dvh',
  maxInlineSize: 'none',
  maxBlockSize: 'none',
  margin: '0',
  padding: '0',
  borderStyle: 'none',
  backgroundColor: 'paper',
  color: 'ink',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
})
export const column = style({
  display: 'grid',
  alignContent: 'start',
  gap: 'section',
  maxInlineSize: '34rem',
  marginInline: 'auto',
  paddingBlock: 'calc(32px + env(safe-area-inset-top)) calc(32px + env(safe-area-inset-bottom))',
  paddingInline: '20px',
})
export const step = style({ margin: '0', fontSize: 'label', color: 'ink2' })
export const title = style({ margin: '0', fontSize: 'heading', fontWeight: 600, textWrap: 'balance' })
export const reason = style({ margin: '0', color: 'ink2', lineHeight: 1.5 })
export const chips = style({ display: 'flex', flexWrap: 'wrap', gap: 'actions' })
/** The house boards, two to a row on a phone, three on a wider screen. */
export const boards = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))',
  gap: 'related',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
/** A board to pick: its face and its name, ringed in ink once picked. */
export const board = style({
  display: 'grid',
  gap: 'snug',
  inlineSize: '100%',
  padding: '6px',
  borderWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'transparent !custom',
  borderRadius: 'panel',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  textAlign: 'start',
  fontSize: 'label',
  cursor: 'pointer',
  '&[aria-pressed="true"]': { borderColor: 'ink' },
})
export const actions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'actions' })
