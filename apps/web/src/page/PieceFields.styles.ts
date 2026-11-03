import { style } from '../zyzz.config.ts'

// The type, colour and attribute pickers shared by adding and editing a piece (Gallery chips and swatches).
export const picker = style({
  display: 'grid',
  gap: 'actions',
  minInlineSize: '0',
  marginBlockStart: '20px',
  marginInline: '0',
  padding: '0',
  borderWidth: '0',
})
export const pickerLegend = style({ padding: '0', marginBlockEnd: '8px', fontSize: 'label', fontWeight: 600 })
export const pickerProblem = style({ fontSize: 'label', color: 'error' })
export const chipSet = style({ display: 'flex', flexWrap: 'wrap', gap: 'actions' })
/** The type picker's groups, one under another, each named above its chips. */
export const typeGroups = style({ display: 'grid', gap: 'grid' })
export const typeGroup = style({ display: 'grid', gap: 'actions' })
export const typeGroupName = style({ fontSize: 'small', color: 'ink2' })
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
  fontSize: 'label',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color, color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-pressed="true"]': { backgroundColor: 'ink', color: 'onInk' },
})
export const swatchSet = style({ display: 'flex', flexWrap: 'wrap', gap: 'tight' })
/** A swatch's 44px target; the chosen one wears an ink ring. The ring is the border, so the focus
 * outline still shows around a chosen swatch. */
export const swatch = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  padding: '0',
  borderWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'transparent !custom',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  cursor: 'pointer',
  '&[aria-pressed="true"]': { borderColor: 'ink' },
})
/** The colours as a fact: one row a colour, its dot then its name. */
export const colourList = style({ display: 'grid', gap: 'snug', margin: '0', padding: '0', listStyleType: 'none' })
export const colourItem = style({ display: 'flex', alignItems: 'center', gap: 'actions' })
export const factDot = style({ inlineSize: '16px', blockSize: '16px' })
/** A colour dot; its `data-colour` picks the swatch, and a chosen dot's check is white or black, whichever reads on it.
 * The swatches are the colours themselves in either scheme, so the check is too (not ink, which turns in dark). */
export const swatchDot = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '28px',
  blockSize: '28px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'pill',
  color: 'swatchWhite',
  '&[data-colour="black"]': { backgroundColor: 'swatchBlack' },
  '&[data-colour="white"]': { backgroundColor: 'swatchWhite', color: 'swatchBlack' },
  '&[data-colour="grey"]': { backgroundColor: 'swatchGrey', color: 'swatchBlack' },
  '&[data-colour="beige"]': { backgroundColor: 'swatchBeige', color: 'swatchBlack' },
  '&[data-colour="brown"]': { backgroundColor: 'swatchBrown' },
  '&[data-colour="navy"]': { backgroundColor: 'swatchNavy' },
  '&[data-colour="blue"]': { backgroundColor: 'swatchBlue' },
  '&[data-colour="green"]': { backgroundColor: 'swatchGreen' },
  '&[data-colour="red"]': { backgroundColor: 'swatchRed' },
  '&[data-colour="pink"]': { backgroundColor: 'swatchPink', color: 'swatchBlack' },
  '&[data-colour="yellow"]': { backgroundColor: 'swatchYellow', color: 'swatchBlack' },
  '&[data-colour="orange"]': { backgroundColor: 'swatchOrange' },
  '&[data-colour="purple"]': { backgroundColor: 'swatchPurple' },
})
