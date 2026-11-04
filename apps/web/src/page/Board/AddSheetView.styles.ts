import { style } from '../../zyzz.config.ts'

// The board's Add sheet: what kind of thing it offers, as one segmented control above the search.

/** The track: four equal segments on paper-2, the chosen one raised on paper. */
export const kinds = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 'hairline',
  padding: '4px',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
})
export const kind = style({
  minBlockSize: '40px',
  paddingInline: '6px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  color: 'ink2',
  fontSize: 'label',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color, color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-pressed="true"]': { backgroundColor: 'paper', color: 'ink', fontWeight: 600, boxShadow: 'lift1' },
})
/** A Gallery photo's tile: the photo, and under it "Just me" when the person is cut out of it. */
export const photo = style({
  inlineSize: '100%',
  blockSize: '100%',
  objectFit: 'cover',
  borderRadius: 'inset',
  pointerEvents: 'none',
})
export const justMe = style({
  justifySelf: 'center',
  minBlockSize: '32px',
  paddingInline: '10px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink',
  fontSize: 'small',
  fontWeight: 600,
  cursor: 'pointer',
  position: 'relative',
  // A 32px pill with a 44px target.
  '::after': { content: '""', position: 'absolute', insetInline: '0', insetBlock: '-6px' },
  ':active': { transform: 'scale(0.96)' },
})
