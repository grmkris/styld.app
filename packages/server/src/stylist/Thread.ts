import { WorkerEntrypoint } from 'cloudflare:workers'
import type { ThreadObjectRpc } from '@yielded/agent-platform-cloudflare/cloudflare-bindings'
import { CloudflareThreadClient } from '@yielded/agent-platform-cloudflare/cloudflare-thread-client'
import * as ThreadObject from '@yielded/agent-platform-cloudflare/thread-object'
import { Agent, Output } from '@yielded/agent'
import type { AgentAttemptContext } from '@yielded/agent/agent-registration'
import { ToolExecutionClass } from '@yielded/agent/durable-step'
import {
  LifecyclePublicationError,
  LifecyclePublicationHandler,
  type LifecyclePublication,
} from '@yielded/agent/lifecycle-publication'
import { WorkerEnvironment } from 'effect-cf'
import { digestDefinitions } from '@yielded/agent/digest'
import type { CanonicalRecordEnvelope } from '@yielded/agent/records'
import { IdempotencyKey, Principal } from '@yielded/agent/submission-ledger'
import { Duration, Effect, Layer, Match, Predicate, Schedule, Schema, Stream } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import { type LanguageModel, Model, Tool, Toolkit } from 'effect/ai'
import {
  type Admission,
  type Admit,
  type ChatRead,
  type Settled,
  stylistAgentId,
  StylistInput,
  stylistDefinitions,
  stylistModelName,
  stylistSubmitAgent,
  type StyldApi,
  type StylistThreadsApi,
  threadIdOf,
} from './Agent.ts'
import { chatOf } from './History.ts'
import { catalogue } from './Catalogue.ts'
import { maxSteps } from './Policy.ts'
import { systemPrompt } from './Prompt.ts'

// The Thread Object that writes Styld's replies (owner, 3 November 2026): one per chat, in its own Worker
// (`ThreadWorker.ts`), so effect-cf owns its alarm and nothing else does. It keeps the chat's canonical history, streams
// the words as they come (LiveText) and asks the model; every tool call runs in the API Worker (`stylistTool`), where
// the assistants' tools already run, and every reply's credit is settled there once (`stylistSettled`), from the
// Thread's lifecycle outbox. The API Worker reaches the Threads through this Worker's entrypoint (`StylistThreads`),
// which names each Object by its Thread from its own namespace: an Object reached through another script's binding
// does not know its name, which Yielded requires.

declare global {
  namespace Cloudflare {
    interface Env {
      readonly STYLD_API: StyldApi
      readonly STYLIST_THREADS: DurableObjectNamespace<ThreadObjectRpc & Erasable>
    }
  }
}

/** A Thread Object that can forget its chat (`makeStylistThread`). */
interface Erasable {
  readonly erase: () => Promise<void>
}

/** The Thread Objects' binding name in the Thread Worker, the namespace they reach each other through. */
const threadsBinding = 'STYLIST_THREADS'

/** A tool the model is offered, with its execution class: a read is repeated freely after an interruption, a write
 * with its operation id is repeated as the same write. */
const toolOf = (entry: (typeof catalogue)[number]) =>
  Tool.dynamic(entry.name, { description: entry.description, parameters: entry.parameters }).annotate(
    ToolExecutionClass,
    entry.execution,
  )

const toolkit = Toolkit.make(...catalogue.map(toolOf))

/** Styld: who it is and how it answers come from the message's input (`Prompt.ts`), the words from the person. */
const stylist = Agent.make(stylistAgentId, {
  input: StylistInput,
  output: Output.text(Schema.String),
  instructions: (input: StylistInput) => Effect.succeed(systemPrompt(input)),
  inputPrompt: (input: StylistInput) => Effect.succeed(input.text),
  toolkit,
  policy: { maxTurns: maxSteps, maxToolCalls: maxSteps * 2, maxDuration: '3 minutes', runStatus: 'off' },
})

/** A tool the API Worker could not be asked to run, as the model reads it. */
const unreachable = {
  error: {
    code: 'unavailable',
    message: 'Styld could not do that just now.',
    recovery: 'Answer from what you already know.',
  },
}

/** Per Attempt: every tool call runs in the API Worker for the Thread's account. */
const attemptLayer = (context: AgentAttemptContext) =>
  Layer.unwrap(
    Effect.map(WorkerEnvironment, (env) =>
      toolkit.toLayer(
        Object.fromEntries(
          catalogue.map(({ name }) => [
            name,
            (params: unknown) =>
              Effect.tryPromise(() =>
                env.STYLD_API.stylistTool({
                  threadId: context.threadId,
                  submissionId: context.submissionId,
                  name,
                  params,
                }),
              ).pipe(Effect.orElseSucceed(() => unreachable)),
          ]),
        ),
      ),
    ),
  )

/** How a published fact ended a reply, if it did. */
const endingOf = (publication: LifecyclePublication): Settled['outcome'] | undefined =>
  Match.value(publication.fact).pipe(
    Match.tag('SubmissionSettled', ({ outcome }): Settled['outcome'] => outcome),
    Match.tag('SubmissionUnknown', (): Settled['outcome'] => 'unknown'),
    Match.orElse(() => undefined),
  )

/** Every reply's ending reaches the API Worker, which settles its credit: published from the Thread's outbox, retried
 * until it is taken, and settled once however often it arrives. */
const settlements = Layer.effect(
  LifecyclePublicationHandler,
  Effect.map(WorkerEnvironment, (env) =>
    LifecyclePublicationHandler.of({
      publish: (batch) =>
        Effect.forEach(
          batch,
          (publication) => {
            const outcome = endingOf(publication)
            const source = publication.source
            if (outcome === undefined || source === undefined) return Effect.void
            return Effect.tryPromise({
              try: () =>
                env.STYLD_API.stylistSettled({
                  principal: source.principal,
                  idempotencyKey: source.idempotencyKey,
                  outcome,
                }),
              catch: (cause) => LifecyclePublicationError.make({ reason: 'unavailable', cause }),
            })
          },
          { discard: true },
        ),
    }),
  ),
)

/** The Thread Object class over a language model: the Worker's own asks Styld's model (`ThreadWorker.ts`); the native
 * suite's a streaming fake. */
export const makeStylistThread = (model: Layer.Layer<LanguageModel.LanguageModel, never, WorkerEnvironment>) =>
  class extends ThreadObject.make(
    ThreadObject.layer(
      [
        {
          agent: stylist,
          model: Model.make('styld', stylistModelName, model),
          definitions: stylistDefinitions,
          attemptLayer,
        },
      ],
      { lifecyclePublication: settlements },
    ),
    { namespaceBinding: threadsBinding, deploymentId: 'styld', producerPrefix: 'styld' },
  ) {
    /** Forget the chat for good, its account being deleted: Yielded Agent (0.1.0-beta.191) has no way to delete a
     * Thread, so its Object's own storage goes (every record, the ledger and the outbox) with its alarm, and the
     * incarnation ends so nothing it held in memory writes again. */
    async erase() {
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.deleteAll()
      this.ctx.abort('erased')
    }
  }

/** The definitions' digests, as admission checks them. */
const digests = digestDefinitions(stylistDefinitions).pipe(Effect.provide(Digest.layerWebCrypto), Effect.orDie)

/** The chats' Threads through this Worker's own namespace. */
const threadsOf = (env: Cloudflare.Env) => CloudflareThreadClient.layerFromBinding({ namespace: env.STYLIST_THREADS })

/** A call to a chat's Thread through this Worker's own namespace. */
const withThreads = <A, E>(
  env: Cloudflare.Env,
  use: (client: CloudflareThreadClient['Service']) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    return yield* use(yield* CloudflareThreadClient)
  }).pipe(Effect.provide(threadsOf(env)))

/** Admit one message to its chat's Thread: the same operation id is the same message, however often it comes. */
/** How long an admission waits for its message to be in the chat's history, where the next read of the chat finds it
 * being answered. A reply admitted behind another starts later; the page shows it once it does. */
const recordedWithin = Duration.seconds(5)

/** Whether the Thread has recorded the message as the input it answers. */
const isRecorded = (records: ReadonlyArray<CanonicalRecordEnvelope>, submissionId: string) =>
  records.some(
    ({ record }) =>
      Predicate.isTagged(record.payload, 'UserInputRecorded') && record.payload.submissionId === submissionId,
  )

const admit = (env: Cloudflare.Env, request: Admit) =>
  withThreads(env, (client) =>
    Effect.gen(function* () {
      const threadId = threadIdOf(request.accountId, request.chatId)
      const receipt = yield* client.submit(stylistSubmitAgent, request.input, {
        threadId,
        principal: Principal.make(request.accountId),
        idempotencyKey: IdempotencyKey.make(request.operationId),
        definitions: yield* digests,
      })
      // The run records its input as it starts, a moment after admission.
      yield* client.readAll(threadId).pipe(
        Effect.orElseSucceed((): ReadonlyArray<CanonicalRecordEnvelope> => []),
        Effect.repeat({
          until: (records) => isRecorded(records, receipt.submissionId),
          schedule: Schedule.spaced('50 millis'),
        }),
        Effect.timeoutOption(recordedWithin),
      )
    }),
  ).pipe(
    Effect.as<Admission>('admitted'),
    // Why a message was not admitted, by its kind alone, never its words.
    Effect.tapError((error) =>
      Effect.logWarning('Styld.Stylist not admitted').pipe(
        Effect.annotateLogs({ 'styld.stylist.failure': error instanceof Error ? error.name : typeof error }),
      ),
    ),
    Effect.catchTags({
      AdmissionConflict: () => Effect.succeed<Admission>('conflict'),
      ThreadClientError: () => Effect.succeed<Admission>('unknown'),
    }),
    Effect.orElseSucceed((): Admission => 'refused'),
  )

/** A chat from its Thread's canonical records; a Thread with none yet is an empty chat. */
const read = (env: Cloudflare.Env, accountId: string, chatId: string) =>
  withThreads(env, (client) => client.readAll(threadIdOf(accountId, chatId))).pipe(
    Effect.map((records): ChatRead => chatOf(records.map(({ record }) => record))),
    Effect.catchTag('ThreadNotMaterialized', () => Effect.succeed<ChatRead>({ messages: [] })),
  )

/** The chat's live words, forwarded as the Thread writes them; the reader going away ends the watch. */
const live = (env: Cloudflare.Env, accountId: string, chatId: string) =>
  Stream.toReadableStream(
    Stream.unwrap(
      Effect.gen(function* () {
        return (yield* CloudflareThreadClient).watchTextBytes(threadIdOf(accountId, chatId))
      }),
    ).pipe(Stream.provide(threadsOf(env)), Stream.orDie),
  )

/** The Thread Worker's entrypoint, which the API Worker binds: admitting, reading and watching chats. Only the API
 * Worker is bound to it; it names the account from the session. */
export class StylistThreads extends WorkerEntrypoint implements StylistThreadsApi {
  admit(request: Admit) {
    return Effect.runPromise(admit(this.env, request))
  }
  chat(accountId: string, chatId: string) {
    return Effect.runPromise(read(this.env, accountId, chatId).pipe(Effect.orDie))
  }
  live(accountId: string, chatId: string) {
    return Promise.resolve(live(this.env, accountId, chatId))
  }
  async erase(accountId: string, chatIds: ReadonlyArray<string>) {
    for (const chatId of chatIds) {
      // An Object that aborts as it ends its incarnation fails the call that asked it to; its storage is gone.
      await this.env.STYLIST_THREADS.getByName(threadIdOf(accountId, chatId))
        .erase()
        .catch(() => undefined)
    }
  }
}
