import { style } from '../zyzz.config.ts'

// The privacy policy and the terms (LegalView.ts): one reading column of plain headings and paragraphs.

/** One column at a reading measure, the sections apart and each heading close to its words. */
export const legalPage = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 'section',
  maxInlineSize: '68ch',
  paddingBlock: 'clamp(24px, 6vw, 64px) clamp(40px, 8vw, 96px)',
})
export const legalSection = style({ display: 'flex', flexDirection: 'column', gap: 'actions' })
export const legalUpdated = style({ color: 'ink2', fontSize: 'small' })
