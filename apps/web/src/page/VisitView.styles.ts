import { style } from '../zyzz.config.ts'

// A person's profile and a piece's page as others see them (Gallery 2: docs/design/gallery-2/site/v2/person.html).
export const page = style({ display: 'grid', gap: '16px', paddingBlock: '8px 40px' })
/** A profile's head (prototype `.person`): the avatar, who they are and the actions centred down a phone; from 900px
 * one wide row, left-aligned, with the actions at its end (`.person.wide`). */
export const person = style({
  display: 'grid',
  justifyItems: 'center',
  gap: '12px',
  paddingBlock: '8px',
  textAlign: 'center',
  '@media (min-width: 900px)': {
    gridTemplateColumns: 'auto minmax(0, 1fr) fit-content(50%)',
    alignItems: 'center',
    justifyItems: 'start',
    columnGap: '28px',
    paddingBlock: '24px 20px',
    textAlign: 'start',
  },
})
/** The name (the page's 30px H1), the handle and city, and the bio. */
export const who = style({
  display: 'grid',
  justifyItems: 'center',
  gap: '4px',
  minInlineSize: '0',
  '@media (min-width: 900px)': { justifyItems: 'start' },
})
/** What the visitor can do: Follow first, then saving, blocking and reporting under it. */
export const side = style({
  display: 'grid',
  justifyItems: 'center',
  gap: '8px',
  '@media (min-width: 900px)': { justifySelf: 'end', justifyItems: 'end' },
})
export const personActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  '@media (min-width: 900px)': { justifyContent: 'flex-end' },
})
/** What Share did: the link copied, or why it wasn't. */
export const shared = style({ margin: '0', fontSize: '14px', color: 'ink2' })
export const problem = style({ margin: '0', fontSize: '14px', color: 'error' })
/** A profile's or a piece's head bar (prototype `.head.bar`): Back at the start, what the page shares at the end. */
export const bar = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' })
/** A piece's bar keeps to its picture's width, so Share sits over the piece it shares. */
export const pieceBar = style({ maxInlineSize: '420px' })
export const barActions = style({ display: 'flex', alignItems: 'center', gap: '8px' })
/** The head bar's room while the page loads: its 44px rounds. */
export const barSkeleton = style({ display: 'block', blockSize: '44px' })
/** A piece's name on its own page. */
export const name = style({ margin: '0', fontSize: '28px', lineHeight: 1.1 })
export const handle = style({ margin: '0', fontSize: '14px', color: 'ink2' })
export const bio = style({ margin: '0', marginBlockStart: '4px', maxInlineSize: '34ch' })
export const tabs = style({
  display: 'flex',
  gap: '4px',
  borderBlockEndWidth: '1px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'rule',
})
export const tab = style({
  minBlockSize: '44px',
  paddingInline: '12px',
  borderWidth: '0',
  borderBlockEndWidth: '2px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'transparent !custom',
  backgroundColor: 'transparent !custom',
  color: 'ink2',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
  '&[aria-pressed="true"]': { color: 'ink', borderBlockEndColor: 'ink' },
})
export const boards = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
  gap: '16px',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
export const empty = style({ color: 'ink2' })
/** Shapes while a profile or a piece loads: the large avatar, the profile's name (the H1, 30px at line height 1.08),
 * the piece's (28px at line height 1.1) and the handle. */
export const avatarSkeleton = style({ inlineSize: '72px', blockSize: '72px', borderRadius: 'pill' })
export const titleSkeleton = style({ fontSize: '30px', blockSize: '0.6em', marginBlock: '0.24em', inlineSize: '8em' })
export const nameSkeleton = style({ fontSize: '28px', blockSize: '0.6em', marginBlock: '0.25em', inlineSize: '8em' })
export const handleSkeleton = style({ fontSize: '14px', inlineSize: '10em' })
export const pieceSkeleton = style({
  inlineSize: '100%',
  maxInlineSize: '420px',
  aspectRatio: '1 / 1',
  borderRadius: 'panel',
})
export const pieceImage = style({
  inlineSize: '100%',
  maxInlineSize: '420px',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'panel',
  backgroundColor: 'paper',
})
