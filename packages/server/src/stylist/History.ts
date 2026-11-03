import { type ChatMessage, LookId, PieceId, type ReplyPart, type Replying, WardrobeAnalysis } from '@styld/protocol'
import type { CanonicalRecordPayload } from '@yielded/agent/records'
import { DateTime, Match, Option, Predicate, Schema } from 'effect'
import { StylistInput } from './Agent.ts'
import { finishedReply } from './Reply.ts'

// A chat as the person reads it, from its Thread's canonical records: each message they sent (`UserInputRecorded`),
// what Styld's tools showed while it answered (`ToolCallSettled`: pieces shown, a look saved, the wardrobe counted) and
// the reply it settled on (`SubmissionSettled`). The cards come from the recorded tool results, never from the words.

const decodeInput = Schema.decodeUnknownOption(StylistInput)
const decodeShown = Schema.decodeUnknownOption(Schema.Struct({ shown: Schema.Array(PieceId) }))
const decodeLook = Schema.decodeUnknownOption(Schema.Struct({ id: LookId, name: Schema.String }))
const decodeAnalysis = Schema.decodeUnknownOption(WardrobeAnalysis)
const decodeText = Schema.decodeUnknownOption(Schema.String)

/** A piece id anywhere in a tool's result: the pieces the reply looked up. */
const pieceIds = /\bpc_[A-Za-z0-9_-]{22}\b/gu

/** What one recorded tool result shows under the reply, if anything. */
const partOf = (toolName: string, result: unknown): Option.Option<ReplyPart> => {
  if (toolName === 'pieces_show')
    return Option.flatMap(decodeShown(result), ({ shown }) =>
      shown.length > 0 ? Option.some<ReplyPart>({ _tag: 'Pieces', pieceIds: shown }) : Option.none(),
    )
  if (toolName === 'look_create')
    return Option.map(decodeLook(result), ({ id, name }): ReplyPart => ({ _tag: 'Look', lookId: id, name }))
  if (toolName === 'wardrobe_analyze')
    return Option.map(decodeAnalysis(result), (analysis): ReplyPart => ({ _tag: 'Analysis', analysis }))
  return Option.none()
}

/** One message being answered: its parts so far and the pieces its tools read. */
interface Answering {
  readonly submissionId: string
  readonly parts: ReadonlyArray<ReplyPart>
  readonly seen: ReadonlySet<string>
}

/** One canonical record, as far as a chat reads it: when it was written and what it says. */
export interface ChatRecord {
  readonly createdAt: DateTime.Utc
  readonly payload: CanonicalRecordPayload
}

/** A chat read so far: its messages, the message being answered and the reply to the last one. */
interface Reading {
  readonly messages: ReadonlyArray<ChatMessage>
  readonly answering?: Answering
  readonly replying?: Replying
}

const writing: Replying = { state: 'writing', text: '', parts: [] }
const failed: Replying = { state: 'failed', text: '', parts: [] }

type Payload<Tag extends CanonicalRecordPayload['_tag']> = Extract<CanonicalRecordPayload, { readonly _tag: Tag }>

/** A message the person sent: it is being answered from now. */
const asked = (reading: Reading, payload: Payload<'UserInputRecorded'>, at: string): Reading => {
  const input = decodeInput(payload.input)
  if (payload.kind !== 'user' || payload.submissionId === undefined || Option.isNone(input)) return reading
  const message: ChatMessage = { id: payload.submissionId, role: 'person', text: input.value.text, parts: [], at }
  return {
    messages: [...reading.messages, message],
    answering: { submissionId: payload.submissionId, parts: [], seen: new Set() },
    replying: writing,
  }
}

/** A tool call the answer made: the pieces it read, and its card if it shows one (one analysis per reply). */
const toolResult = (reading: Reading, payload: Payload<'ToolCallSettled'>): Reading => {
  const { answering } = reading
  if (answering === undefined || payload.isFailure) return reading
  const seen = new Set([...answering.seen, ...[...JSON.stringify(payload.result).matchAll(pieceIds)].map(([id]) => id)])
  const part = Option.filter(
    partOf(payload.toolName, payload.result),
    (shown) => !(Predicate.isTagged(shown, 'Analysis') && answering.parts.some(Predicate.isTagged('Analysis'))),
  )
  const parts = Option.match(part, { onNone: () => answering.parts, onSome: (shown) => [...answering.parts, shown] })
  return { ...reading, answering: { ...answering, parts, seen } }
}

/** The answer settled: a reply that came, with its readable words and cards, or one that did not. */
const answered = (reading: Reading, payload: Payload<'SubmissionSettled'>, at: string): Reading => {
  const { answering } = reading
  if (answering?.submissionId !== payload.submissionId) return reading
  const completed = payload.outcome === 'completed'
  const reply = finishedReply(
    completed ? Option.getOrElse(decodeText(payload.result), () => '') : '',
    answering.parts,
    answering.seen,
  )
  if (!completed || (reply.text.length === 0 && reply.parts.length === 0))
    return { messages: reading.messages, replying: failed }
  const message: ChatMessage = { id: payload.settlementId, role: 'styld', text: reply.text, parts: reply.parts, at }
  return { messages: [...reading.messages, message] }
}

/** The chat's messages, and the reply to its last one while it is written or when it did not come. */
export const chatOf = (
  records: ReadonlyArray<ChatRecord>,
): { readonly messages: ReadonlyArray<ChatMessage>; readonly replying?: Replying } => {
  const { messages, replying } = records.reduce<Reading>(
    (reading, { createdAt, payload }) => {
      const at = DateTime.formatIso(createdAt)
      return Match.value(payload).pipe(
        Match.tag('UserInputRecorded', (input) => asked(reading, input, at)),
        Match.tag('ToolCallSettled', (call) => toolResult(reading, call)),
        Match.tag('SubmissionSettled', (settled) => answered(reading, settled, at)),
        Match.orElse(() => reading),
      )
    },
    { messages: [] },
  )
  return replying === undefined ? { messages } : { messages, replying }
}
