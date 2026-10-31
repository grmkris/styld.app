import { style } from '../zyzz.config.ts'

// Styles for Styld's chat in StylistView.ts: a column of messages above a composer that stays in reach.

/** The page reaches at least to the bottom of the screen, as a tab page's does (View.styles.ts › tabPage), so the
 * site's footer waits below the fold while the chat arrives; the composer rests at its end. On a phone the page ends
 * as far below the composer as the paper under it reaches, so at the end of a long chat that paper covers the page's
 * own padding and the footer follows whole, its language picker in reach. */
export const page = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  maxInlineSize: '40rem',
  minBlockSize: 'calc(100svh - max(64px, 60px + env(safe-area-inset-top)))',
  // On a wide screen the chat is a centred column, not one hugging the rail, under the rail's 32px rather than a
  // top bar.
  '@media (min-width: 900px)': { marginInline: 'auto', inlineSize: '100%', minBlockSize: 'calc(100svh - 32px)' },
  '@media (max-width: 899px)': { paddingBlockEnd: 'calc(96px + env(safe-area-inset-bottom))' },
  paddingBlockStart: '8px',
})
/** As tall as New chat, so the title stays put when the button comes. */
export const pageBar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  minBlockSize: '48px',
})
export const lede = style({ color: 'ink2' })
/** The ways to start, as whole sentences: each its own pill, wrapping if it must, one under the other. */
export const starters = style({ display: 'grid', justifyItems: 'start', gap: '8px' })
export const starter = style({
  whiteSpace: 'normal',
  textAlign: 'start',
  textWrap: 'pretty',
  paddingBlock: '8px',
  fontWeight: 500,
})
export const thread = style({ display: 'grid', gap: '14px', margin: '0', padding: '0', listStyleType: 'none' })
/** The person's message, set apart on the right. */
export const person = style({
  justifySelf: 'end',
  maxInlineSize: '85%',
  paddingBlock: '10px',
  paddingInline: '14px',
  borderRadius: 'panel',
  backgroundColor: 'paper2',
  color: 'ink',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
})
/** The skeleton's message, on the right as the person's are, and the end of its reply. */
export const personSkeleton = style({
  justifySelf: 'end',
  inlineSize: '45%',
  blockSize: '44px',
  borderRadius: 'panel',
})
export const shortSkeleton = style({ inlineSize: '35%' })
/** Styld's reply: plain text, its paragraphs as written. */
export const reply = style({ display: 'grid', gap: '10px', color: 'ink', lineHeight: 1.5 })
export const replyText = style({ margin: '0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' })
/** The pieces a reply shows, in a row that scrolls sideways; on a phone it runs to the screen's edge rather than the
 * gutter, as Ask's chips do, so it reads as more to come. */
export const pieces = style({
  display: 'flex',
  gap: '12px',
  margin: '0',
  padding: '0',
  listStyleType: 'none',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  '@media (max-width: 899px)': {
    marginInline: 'calc(-1 * max(20px, env(safe-area-inset-left)))',
    paddingInline: 'max(20px, env(safe-area-inset-left))',
    scrollPaddingInline: 'max(20px, env(safe-area-inset-left))',
  },
})
/** A piece Styld shows: its cutout straight on the paper, as pieces you own are, with its name under it. A picture
 * that is still the person's photo lets its pale backdrop give way to the paper. The blend sits on the link, not the
 * image: the press's scale makes the link a stacking context, which would keep the image's blend from the paper. */
export const pieceLink = style({
  display: 'grid',
  gap: '4px',
  justifyItems: 'center',
  inlineSize: '96px',
  color: 'ink',
  textDecorationLine: 'none',
  mixBlendMode: 'darken',
  transitionProperty: 'transform, translate',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  // It lifts under the pointer as a wardrobe tile does; translate composes with the press's scale.
  '@media (hover: hover) and (pointer: fine)': { ':hover': { translate: '0 -2px' } },
})
export const pieceImage = style({ display: 'block', inlineSize: '96px', blockSize: '96px', objectFit: 'contain' })
export const pieceName = style({
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  fontSize: '13px',
  lineHeight: 1.35,
  color: 'ink2',
  textAlign: 'center',
})
/** Where the newest message is scrolled to: 16px above the composer resting in its place. A scroll into view adds
 * the page's own scroll padding, which on a phone already holds the floating nav's 88px and the safe area
 * (GlobalStyles.ts), so the margin adds the rest: the composer's 96px inset and 88px less that 88px, and the 16px
 * gap. A wide screen has no such padding: the composer's 16px inset, its 88px and the gap. */
export const latest = style({
  scrollMarginBlockEnd: '112px',
  '@media (min-width: 900px)': { scrollMarginBlockEnd: '120px' },
})
export const status = style({ display: 'flex', alignItems: 'center', gap: '8px', color: 'ink2', fontSize: '14px' })
export const failed = style({ color: 'ink2', fontSize: '14px' })
/** Earlier chats, by their first message. */
export const chats = style({ display: 'grid', margin: '0', padding: '0', listStyleType: 'none' })
export const chatLink = style({
  display: 'grid',
  gap: '2px',
  inlineSize: '100%',
  minBlockSize: '52px',
  paddingBlock: '8px',
  paddingInline: '0',
  borderWidth: '0',
  borderBlockEndWidth: '1px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'rule',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  textAlign: 'start',
  cursor: 'pointer',
  // Hovered, its title takes a text link's underline (DESIGN.md › Text links).
  '@media (hover: hover) and (pointer: fine)': {
    '&:hover > :first-child': {
      textDecorationLine: 'underline',
      textDecorationColor: 'signal',
      textDecorationThickness: '1.5px',
      textUnderlineOffset: '4px',
    },
  },
})
export const chatTitle = style({ fontSize: '15px' })
export const chatDate = style({ fontSize: '13px', color: 'ink2', fontVariantNumeric: 'tabular-nums' })
export const sectionTitle = style({ fontSize: '17px', fontWeight: 600 })
/** The composer: in reach at the bottom of the screen, clear of the phone's floating navigation, and at the end of a
 * long chat above the site's footer rather than over it (the page's padding below it, `page`). */
export const composer = style({
  position: 'sticky',
  insetBlockEnd: 'calc(96px + env(safe-area-inset-bottom))',
  zIndex: 4,
  display: 'grid',
  gap: '6px',
  marginBlockStart: 'auto',
  paddingBlock: '10px',
  backgroundColor: 'paper',
  '@media (min-width: 900px)': { insetBlockEnd: 'max(16px, env(safe-area-inset-bottom))' },
  // On a phone the composer stands above the floating tab bar; paper under it to the screen's foot, so what scrolls
  // beneath never shows between them and reads as part of the price line.
  '@media (max-width: 899px)': {
    '::before': {
      content: '""',
      position: 'absolute',
      insetBlockStart: '100%',
      insetInline: 'calc(-1 * max(20px, env(safe-area-inset-left)))',
      blockSize: 'calc(96px + env(safe-area-inset-bottom))',
      backgroundColor: 'paper',
    },
  },
})
/** The field and its send button in one row. */
export const composerRow = style({ display: 'flex', alignItems: 'end', gap: '8px' })
/** The field takes the site's text area look (Fields.styles.ts), growing with what is written up to a point; one line
 * stands as tall as the send button beside it. */
export const field = style({
  flexGrow: 1,
  minInlineSize: '0',
  minBlockSize: '44px',
  maxBlockSize: '160px',
  paddingBlock: '9px',
})
export const send = style({
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  inlineSize: '44px',
  blockSize: '44px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
  cursor: 'pointer',
  transitionProperty: 'transform, opacity, background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  // Foldkit UI's Button marks a disabled one data-disabled and aria-disabled, never the native attribute.
  '&[data-disabled]': { opacity: 0.5, cursor: 'not-allowed' },
  '@media (hover: hover) and (pointer: fine)': { '&:not([data-disabled]):hover': { backgroundColor: 'inkHover' } },
})
export const price = style({ fontSize: '13px', color: 'ink3' })
export const problem = style({ fontSize: '14px', color: 'error' })
