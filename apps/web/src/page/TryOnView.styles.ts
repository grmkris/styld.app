import { style } from '../zyzz.config.ts'
export { actionRow as actions, note, problem } from '../Controls.styles.ts'

// Styles for Try on in TryOnView.ts: the person's try-ons, a new one being chosen, and one beside its photo.
export const page = style({ display: 'grid', gap: 'grid', paddingBlock: '0 40px' })
/** A try-on's tile and a photo to choose are buttons shaped as the Gallery's tiles; the chosen photo is ringed. */
export const tileButton = style({
  inlineSize: '100%',
  padding: '0',
  borderWidth: '0',
  cursor: 'pointer',
  ':active': { transform: 'scale(0.98)' },
  // The chosen ring gives way to the focus ring while the tile has the keyboard's focus.
  '&[aria-pressed="true"]:not(:focus-visible)': {
    outlineWidth: '3px',
    outlineStyle: 'solid',
    outlineColor: 'ink',
    outlineOffset: '2px',
  },
})
export const step = style({ display: 'grid', gap: 'related', justifyItems: 'start' })
export const stepTitle = style({ fontSize: 'subheading' })
/** The Gallery's photos to choose from: three across on a phone, six on a wide screen. */
export const photoGrid = style({
  display: 'grid',
  inlineSize: '100%',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 'related',
  padding: '0',
  listStyleType: 'none',
  '@media (min-width: 900px)': { gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' },
})
export const looks = style({ display: 'flex', flexWrap: 'wrap', gap: 'actions' })
export const consent = style({ display: 'grid', gap: 'related' })
export const thisIsMe = style({ display: 'inline-flex', alignItems: 'center', gap: 'actions', fontWeight: 600 })
/** The "This is me" box: a square that holds a tick when checked. */
export const box = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '24px',
  blockSize: '24px',
  padding: '0',
  borderWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'ink',
  borderRadius: 'photo',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  cursor: 'pointer',
  '&[aria-disabled="true"]': { opacity: 0.5, cursor: 'default' },
})
export const caption = style({ marginBlockStart: '8px', fontSize: 'label', color: 'ink2', textAlign: 'center' })
export const compare = style({ display: 'grid', gap: 'related' })
/** Before and After, chosen on a phone; a wide screen shows both. */
export const sides = style({
  display: 'flex',
  gap: 'actions',
  justifyContent: 'center',
  '@media (min-width: 900px)': { display: 'none' },
})
export const pair = style({
  display: 'grid',
  gap: 'gutter',
  '@media (min-width: 900px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
})
export const figure = style({
  margin: '0',
  '@media (max-width: 899px)': {
    '[data-showing="after"] > &[data-side="before"]': { display: 'none' },
    '[data-showing="before"] > &[data-side="after"]': { display: 'none' },
  },
})
export const picture = style({
  display: 'block',
  inlineSize: '100%',
  maxBlockSize: '75vh',
  objectFit: 'contain',
  borderRadius: 'photo',
  backgroundColor: 'stock',
})
