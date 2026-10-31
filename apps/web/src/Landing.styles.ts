import { style } from './zyzz.config.ts'

/** The way on from the landing's boards to all of them: a text link with a 44px target that says where it goes. */
export const seeAll = style({
  display: 'inline-flex',
  alignItems: 'center',
  minBlockSize: '44px',
  justifySelf: 'start',
})

// The landing's hero in Landing.ts, around the statement View.styles.ts draws: on a desktop the words take the left
// and a public board's table the right, so clothes show on the first screen.

/** One column on a phone, as the statement alone; from 900px the words and the board side by side. */
export const hero = style({
  '@media (min-width: 900px)': {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    alignItems: 'center',
    columnGap: '48px',
  },
})
/** The board beside the words: as large as fits the first screen under the bar with room around it, up to 520px.
 * A phone shows none. */
export const heroBoard = style({
  display: 'none',
  '@media (min-width: 900px)': {
    display: 'block',
    justifySelf: 'end',
    inlineSize: 'min(100%, (100svh - 160px) * 0.8, 520px)',
    marginBlock: '24px',
  },
})
/** The board's paper in outline while the boards load. */
export const heroSkeleton = style({ aspectRatio: '4 / 5', borderRadius: 'table' })
