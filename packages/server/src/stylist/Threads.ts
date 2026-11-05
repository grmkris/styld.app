import { OperationConflict, Unavailable } from '@styld/protocol'
import { Context, Effect, Layer, Schema, Stream } from 'effect'
import { Admission, ChatRead, type StylistInput, type StylistThreadsApi } from './Agent.ts'
import { called } from '../kernel/Bindings.ts'

// The API Worker's side of the chats' Threads: admitting a message, reading a chat and forwarding its live words,
// through the Thread Worker's entrypoint (`Thread.ts` `StylistThreads`). Every call names the account from the session;
// the Thread Worker joins it with the chat into the Thread's id, never the browser.

/** A message its Thread refused for good: its credit comes back. */
export class Refused extends Schema.TaggedError<Refused>()('Refused', {}) {}

/** What an admission's answer means for the request. */
const settledBy = (admission: Admission): Effect.Effect<void, OperationConflict | Refused | Unavailable> => {
  if (admission === 'admitted') return Effect.void
  if (admission === 'conflict') return Effect.fail(OperationConflict.make({}))
  if (admission === 'refused') return Effect.fail(Refused.make({}))
  return Effect.fail(Unavailable.make({}))
}

/** A call to the Thread Worker that did not answer is unavailable. */
const call = called

const decodeAdmission = Schema.decodeUnknownEffect(Admission)
const decodeChat = Schema.decodeUnknownEffect(ChatRead)

const make = (threads: StylistThreadsApi) => ({
  /** Admit one message to its chat's Thread. A refusal for good is `Refused`; one whose answer was lost is
   * `Unavailable`, and the same request may be sent again as the same message. */
  submit: (accountId: string, chatId: string, operationId: string, input: StylistInput) =>
    call(() => threads.admit({ accountId, chatId, operationId, input })).pipe(
      Effect.flatMap((answer) => Effect.mapError(decodeAdmission(answer), () => Unavailable.make({}))),
      Effect.flatMap(settledBy),
    ),
  /** A chat as its Thread tells it. */
  chat: (accountId: string, chatId: string) =>
    call(() => threads.chat(accountId, chatId)).pipe(
      Effect.flatMap((answer) => Effect.mapError(decodeChat(answer), () => Unavailable.make({}))),
    ),
  /** Forget the account's chats for good, each Thread's storage with it (account deletion). */
  erase: (accountId: string, chatIds: ReadonlyArray<string>) => call(() => threads.erase(accountId, chatIds)),
  /** The chat's live words as its Thread writes them (NDJSON), forwarded without decoding. */
  live: (accountId: string, chatId: string) =>
    Stream.unwrap(
      Effect.map(
        call(() => threads.live(accountId, chatId)),
        (body) => Stream.fromReadableStream({ evaluate: () => body, onError: () => Unavailable.make({}) }),
      ),
    ),
})

/** The chats' Threads, through the Thread Worker the stack binds to the API Worker as `STYLIST_THREADS`. */
export class StylistThreads extends Context.Service<StylistThreads, ReturnType<typeof make>>()(
  '@styld/server/stylist/StylistThreads',
) {
  static readonly layer = (threads: StylistThreadsApi) => Layer.succeed(this, make(threads))
}
