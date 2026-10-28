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
