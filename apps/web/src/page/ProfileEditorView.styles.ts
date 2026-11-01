import { style } from '../zyzz.config.ts'
export { note, problem } from '../Controls.styles.ts'

// The profile editor: who you are to others, and whether they can see it.
export const page = style({ display: 'grid', gap: 'section', maxInlineSize: '36rem', paddingBlock: '8px 40px' })
export const who = style({ display: 'flex', alignItems: 'center', gap: 'grid' })
export const form = style({ display: 'grid', gap: 'grid' })
export const field = style({ display: 'grid', gap: 'snug', fontSize: 'label', fontWeight: 600 })
export const hint = style({ fontSize: 'small', fontWeight: 400, color: 'ink3' })
export const handleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 'snug',
  fontSize: 'body',
  fontWeight: 400,
})
/** The avatar colour: a legend like a field's label over a row of tone swatches. */
export const tones = style({ display: 'grid', gap: 'snug', margin: '0', padding: '0', borderWidth: '0' })
export const legend = style({ padding: '0', fontSize: 'label', fontWeight: 600 })
/** All eight swatches on one row: a phone's column is narrower than eight 44px targets with gaps. */
export const toneRow = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
  maxInlineSize: '384px',
})
/** A 44px target around a 36px swatch; the chosen one wears an ink ring, and keyboard focus the focus ring. */
export const tone = style({
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '100%',
  maxInlineSize: '44px',
  blockSize: '44px',
  cursor: 'pointer',
  '&:has(:checked) > span': { outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'ink', outlineOffset: '3px' },
  '&:has(:focus-visible) > span': {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: 'focus',
    outlineOffset: '3px',
  },
})
export const swatch = style({ inlineSize: '32px', blockSize: '32px' })
export const count = style({ fontSize: 'small', fontWeight: 400, color: 'ink2', fontVariantNumeric: 'tabular-nums' })
/** Save, full width at the form's end, with what saving says under it. */
export const save = style({ display: 'grid', gap: 'actions', '& > button': { inlineSize: '100%' } })
/** Where the profile stands, under the title. */
export const standing = style({ display: 'grid', gap: 'actions', marginBlockStart: '-12px' })
export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  rowGap: 'actions',
  columnGap: 'related',
})
/** Shapes while the profile loads: the large avatar, the title (30px at line height 1.08), a label, a field. */
export const avatarSkeleton = style({ flex: 'none', inlineSize: '72px', blockSize: '72px', borderRadius: 'pill' })
export const titleSkeleton = style({ fontSize: 'title', blockSize: '0.6em', marginBlock: '0.24em', inlineSize: '6em' })
export const labelSkeleton = style({ fontSize: 'label', inlineSize: '6em' })
export const fieldSkeleton = style({ inlineSize: '100%', blockSize: '52px', borderRadius: 'field' })
