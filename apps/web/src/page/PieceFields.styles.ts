import { style } from '../zyzz.config.ts'

// The category, shelf and colour pickers shared by adding and editing a piece (Gallery chips and swatches).
export const picker = style({
  display: 'grid',
  gap: '8px',
  minInlineSize: '0',
  marginBlockStart: '20px',
  padding: '0',
  borderWidth: '0',
})
export const pickerLegend = style({ padding: '0', marginBlockEnd: '8px', fontSize: '14px', fontWeight: 600 })
export const pickerProblem = style({ fontSize: '14px', color: 'error' })
export const chipSet = style({ display: 'flex', flexWrap: 'wrap', gap: '8px' })
/** A 36px pill on paper-2; the chosen one is filled ink (DESIGN.md › Controls › Chips). */
export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  minBlockSize: '36px',
  paddingInline: '16px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color, color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-pressed="true"]': { backgroundColor: 'ink', color: 'onInk' },
})
export const swatchSet = style({ display: 'flex', flexWrap: 'wrap', gap: '4px' })
/** A swatch's 44px target; the chosen one wears an ink ring. */
export const swatch = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  padding: '0',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  cursor: 'pointer',
  '&[aria-pressed="true"]': {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: 'ink',
    outlineOffset: '-3px',
  },
})
/** A colour dot; its `data-colour` picks the swatch, and a chosen dot's check takes the ink that reads on it. */
export const swatchDot = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '28px',
  blockSize: '28px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'pill',
  color: 'onInk',
  '&[data-colour="black"]': { backgroundColor: 'swatchBlack' },
  '&[data-colour="white"]': { backgroundColor: 'swatchWhite', color: 'ink' },
  '&[data-colour="grey"]': { backgroundColor: 'swatchGrey', color: 'ink' },
  '&[data-colour="beige"]': { backgroundColor: 'swatchBeige', color: 'ink' },
  '&[data-colour="brown"]': { backgroundColor: 'swatchBrown' },
  '&[data-colour="navy"]': { backgroundColor: 'swatchNavy' },
  '&[data-colour="blue"]': { backgroundColor: 'swatchBlue' },
  '&[data-colour="green"]': { backgroundColor: 'swatchGreen' },
  '&[data-colour="red"]': { backgroundColor: 'swatchRed' },
  '&[data-colour="pink"]': { backgroundColor: 'swatchPink', color: 'ink' },
  '&[data-colour="yellow"]': { backgroundColor: 'swatchYellow', color: 'ink' },
  '&[data-colour="orange"]': { backgroundColor: 'swatchOrange' },
  '&[data-colour="purple"]': { backgroundColor: 'swatchPurple' },
})
