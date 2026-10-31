import { style } from '../zyzz.config.ts'

// Styles for Styld's chat in StylistView.ts: a column of messages above a composer that stays in reach.

/** The page reaches at least to the bottom of the screen, as a tab page's does (View.styles.ts › tabPage), so the
 * site's footer waits below the fold while the chat arrives; the composer rests at its end. */
export const page = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  maxInlineSize: '40rem',
  minBlockSize: 'calc(100svh - max(64px, 60px + env(safe-area-inset-top)))',
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
/** The pieces a reply shows, in a row that scrolls sideways. */
export const pieces = style({
  display: 'flex',
  gap: '12px',
  margin: '0',
  padding: '0',
  listStyleType: 'none',
  overflowX: 'auto',
  scrollbarWidth: 'none',
})
/** A piece Styld shows: its cutout straight on the paper, as pieces you own are, with its name under it. */
export const pieceLink = style({
  display: 'grid',
  gap: '4px',
  inlineSize: '96px',
  color: 'ink',
  textDecorationLine: 'none',
  transitionProperty: 'transform',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
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
})
/** Where the newest message is scrolled to: far enough above the end to clear the composer and, on a phone, the
 * floating nav under it. */
export const latest = style({
  scrollMarginBlockEnd: 'calc(220px + env(safe-area-inset-bottom))',
  '@media (min-width: 900px)': { scrollMarginBlockEnd: '140px' },
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
  borderWidth: '0',
  borderBlockEndWidth: '1px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'rule',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  textAlign: 'start',
  cursor: 'pointer',
})
export const sectionTitle = style({ fontSize: '17px', fontWeight: 600 })
/** The composer: in reach at the bottom of the screen, clear of the phone's floating navigation, and at the end of a
 * long chat above the site's footer rather than over it. */
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
})
/** The field and its send button in one row. */
export const composerRow = style({ display: 'flex', alignItems: 'end', gap: '8px' })
/** The field takes the site's text field look (Fields.styles.ts), growing with what is written up to a point. */
export const field = style({
  flexGrow: 1,
  minInlineSize: '0',
  minBlockSize: '44px',
  maxBlockSize: '160px',
  resize: 'none',
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
  transitionProperty: 'transform, opacity',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  // Foldkit UI's Button marks a disabled one data-disabled and aria-disabled, never the native attribute.
  '&[data-disabled]': { opacity: 0.5, cursor: 'not-allowed' },
})
export const price = style({ fontSize: '13px', color: 'ink3' })
export const problem = style({ fontSize: '14px', color: 'error' })
