import { keyframes } from 'zyzz/web'
import { style } from './zyzz.config.ts'

const spin = keyframes({ to: { transform: 'rotate(360deg)' } }, { id: 'styld-spin' })

/** The loader: sized to the text beside it, one turn every 0.9s. It keeps turning under
 * reduced motion; GlobalStyles.ts exempts `data-loader` from the stop (DESIGN.md › Motion). */
export const loaderIcon = style({
  inlineSize: '1.25em',
  blockSize: '1.25em',
  flex: 'none',
  animationName: spin,
  animationDuration: '0.9s',
  animationTimingFunction: 'linear',
  animationIterationCount: 'infinite',
})

/** A control icon: 20px, Regular weight (DESIGN.md › Icons). */
export const controlIcon = style({ inlineSize: '20px', blockSize: '20px', flex: 'none' })

/** A tab icon: 24px, Light weight. */
export const tabIcon = style({ inlineSize: '24px', blockSize: '24px', flex: 'none' })
