# Dependency patches

## Alchemy Domain beta.85 optional `read` under exact optional properties

Pinned `@alchemy.run/domain@2.0.0-beta.85` records an aggregate's declared `read` contract in its type, and an
aggregate that declares none gets `read: undefined` (`Resolved` in `src/Aggregate.ts`). The constraint every aggregate
must satisfy, `AnyDefinition`, declares `readonly read?: Read.AnyContract`. Under this repository's
`exactOptionalPropertyTypes`, `undefined` is not assignable to that optional property, so an aggregate without a read
contract (the Wallet: no Api exposes it) is not an `Aggregate.Any`, and `Model`, `Story` and the clients reject it.

`patches/@alchemy.run%2Fdomain@2.0.0-beta.85.patch` widens that one property to `Read.AnyContract | undefined` in
`src/Aggregate.ts` and `lib/Aggregate.d.ts`. It is a type-only change: no runtime file is touched, and the runtime
already treats a missing and an `undefined` read alike (`definition.read !== undefined`). Bun applies the
version-specific patch through the lockfile.

`bun run typecheck` covers it (the Wallet, its story tests and every Holds caller). On a Domain upgrade, drop the patch
if `AnyDefinition` accepts `undefined` upstream and rerun the typecheck. No upstream issue has been submitted.

The beta.84 patch that exposed `@alchemy.run/domain/internal` is gone: beta.85's Cloudflare adapter imports
`captureContext` from the public `@alchemy.run/domain/Platform`. `tools/dependency-contracts.test.ts` still imports the
adapter under Node and Bun.

## Alchemy Cloudflare beta.85 queue settlement

Pinned `@alchemy.run/cloudflare@2.0.0-beta.85` (unchanged since beta.84) acknowledges every message of a batch once a queue handler succeeds, and retries every message when it fails (`src/Queues/EventSource.ts` and `lib/Queues/EventSource.js`, in `EventSourceLive`). Styld settles each delivery itself (`packages/server/src/jobs/Jobs.ts`: acked when the job ran, retried before its last attempt), so the blanket ack after a handler retried a message logged Cloudflare's "ack() after retry()" warning on every retry and could, if the runtime ever honoured the later call, drop a message that was meant to come back.

`patches/@alchemy.run%2Fcloudflare@2.0.0-beta.85.patch` (rebased from beta.84) hands the handler wrappers of the batch's messages that record whether `ack()` or `retry()` was called, and acks (or, on a handler failure, retries) only the messages left unsettled. Behaviour for handlers that never settle a message themselves is unchanged. Bun applies the version-specific patch through the lockfile.

The native queue journeys (captures, clean pictures, turns, Styld's replies) cover it in workerd; Workers Logs on the preview should show no ack warnings. On an Alchemy upgrade, inspect `EventSourceLive`, drop the patch if upstream settles only unsettled messages, and rerun the native suite. No upstream issue has been submitted.

## Removed with the Effect 4.1 upgrade

`patches/@foldkit%2Fvite-plugin@0.28.0.patch` called `randomUUIDv4` as a function for Effect 4.0's `Crypto`.
`@foldkit/vite-plugin@0.29.0` is built on Effect 4.1's `effect/crypto/SecureRandom` and needs no patch.
