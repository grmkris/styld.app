import { style } from '../../zyzz.config.ts'

// What a table adds to the editor's item styles (View.styles.ts) wherever it lies: Home, Boards and the editor.

/** A piece's frame: a picture that is still the person's photo lets its pale backdrop give way to the paper, as the
 * wardrobe's do. The blend sits on the frame, not the image: the frame's translate, rotate and scale make it a
 * stacking context, which would keep a blend set on the image from reaching the paper. */
export const pieceFrame = style({ mixBlendMode: 'darken' })
