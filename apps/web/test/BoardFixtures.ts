import { BoardSummary } from '@styld/protocol'
import { Schema } from 'effect'

/** A board as the person's list returns it, named `name`; the id is a valid opaque id built from the name. */
export const boardSummaryFixture = (name: string, fields: Partial<Record<keyof BoardSummary, unknown>> = {}) =>
  Schema.decodeUnknownSync(BoardSummary)({
    id: `bd_${name.padEnd(22, 'x')}`,
    name,
    paper: 'paper',
    items: [],
    cover: [],
    pinCount: 0,
    visibility: 'private',
    updatedAt: '2026-10-30T08:00:00.000Z',
    ...fields,
  })
