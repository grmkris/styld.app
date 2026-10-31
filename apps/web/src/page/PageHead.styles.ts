import { style } from '../zyzz.config.ts'

// The top of a tab page in PageHead.ts (Gallery 2 `.head`): every tab page's title starts at the same height.

/** 8px under the top bar, then one row at least 44px tall: the title at its start, the round action or an empty
 * slot of the same size at its end. */
export const head = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  minBlockSize: '52px',
  paddingBlockStart: '8px',
})
/** The title fills the row, so its box starts at the row's top whatever its size; its words sit in the middle. */
export const title = style({ display: 'flex', alignItems: 'center', minBlockSize: '44px', minInlineSize: '0' })
export const slot = style({ flex: 'none', inlineSize: '44px', blockSize: '44px' })
/** The dark round action (Gallery `.round.dark`), such as adding a piece or a board: the primary action's ink pill,
 * with its hover, press and disabled states, drawn as a 44px circle. Combine with primaryAction. */
export const roundAction = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  minBlockSize: '44px',
  flex: 'none',
  paddingInline: '0',
})
/** A round action that names itself on a wide screen (Gallery `wardrobe-desktop.html` › `button.btn`). */
export const wideAction = style({
  '@media (min-width: 900px)': {
    display: 'inline-flex',
    alignItems: 'center',
    inlineSize: 'auto',
    gap: '8px',
    paddingInline: '20px',
  },
})
/** The round's words: read, not shown, on a phone; shown beside the icon on a wide screen. */
export const wideLabel = style({
  '@media (max-width: 899px)': {
    position: 'absolute',
    inlineSize: '1px',
    blockSize: '1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
})
