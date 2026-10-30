import { style } from './zyzz.config.ts'

// A person's initials on their tone (Gallery 2's `.ava`): the profile, its editor, credits on pins.
export const avatar = style({
  display: 'inline-grid',
  flex: 'none',
  placeItems: 'center',
  borderRadius: 'pill',
  backgroundColor: 'tintSand',
  color: 'ink',
  fontWeight: 800,
  letterSpacing: '-0.02em',
  '&[data-tone="sage"]': { backgroundColor: 'tintSage' },
  '&[data-tone="slate"]': { backgroundColor: 'tintSlate' },
  '&[data-tone="clay"]': { backgroundColor: 'tintClay' },
  '&[data-tone="stone"]': { backgroundColor: 'toneStone' },
  '&[data-tone="plum"]': { backgroundColor: 'tonePlum' },
  '&[data-tone="olive"]': { backgroundColor: 'toneOlive' },
  '&[data-tone="ink"]': { backgroundColor: 'ink', color: 'onInk' },
  inlineSize: '44px',
  blockSize: '44px',
  fontSize: '15px',
  '&[data-size="small"]': { inlineSize: '24px', blockSize: '24px', fontSize: '10px', letterSpacing: '0' },
  '&[data-size="large"]': { inlineSize: '72px', blockSize: '72px', fontSize: '22px' },
})
