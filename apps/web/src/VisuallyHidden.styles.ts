import { style } from './zyzz.config.ts'

/** Text for assistive technology only, such as what a skeleton is waiting for or a field's label. */
export const visuallyHidden = style({
  position: 'absolute',
  inlineSize: '1px',
  blockSize: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
})
