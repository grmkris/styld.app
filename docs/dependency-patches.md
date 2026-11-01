# Dependency patches

## Alchemy Domain beta.84 export map

Pinned `@alchemy.run/cloudflare@2.0.0-beta.84` imports `captureContext` from `@alchemy.run/domain/internal` in both its source and compiled Domain adapter. The matching published Domain package ships those files but sets that subpath to `null` in its export map. An ordinary adapter import fails under Bun before hosting can start.

`patches/@alchemy.run%2Fdomain@2.0.0-beta.84.patch` exposes only that existing subpath with type, Bun/Worker source and default compiled conditions. It changes no algorithm or persistence semantics. Bun applies the version-specific patch through the lockfile. Application code must continue using public Domain APIs.

The dependency-contract test imports the adapter under Node and Bun. Native Worker bundling and hosting remain separate checks. On a coordinated Alchemy upgrade, inspect the upstream export map, remove this patch if repaired, and rerun both import and native lifecycle tests. No upstream issue has been submitted.

## Alchemy Cloudflare beta.84 queue settlement

Pinned `@alchemy.run/cloudflare@2.0.0-beta.84` acknowledges every message of a batch once a queue handler succeeds, and retries every message when it fails (`src/Queues/EventSource.ts` and `lib/Queues/EventSource.js`, in `EventSourceLive`). Styld settles each delivery itself (`packages/server/src/jobs/Jobs.ts`: acked when the job ran, retried before its last attempt), so the blanket ack after a handler retried a message logged Cloudflare's "ack() after retry()" warning on every retry and could, if the runtime ever honoured the later call, drop a message that was meant to come back.

`patches/@alchemy.run%2Fcloudflare@2.0.0-beta.84.patch` hands the handler wrappers of the batch's messages that record whether `ack()` or `retry()` was called, and acks (or, on a handler failure, retries) only the messages left unsettled. Behaviour for handlers that never settle a message themselves is unchanged. Bun applies the version-specific patch through the lockfile.

The native queue journeys (captures, clean pictures, turns, Styld's replies) cover it in workerd; Workers Logs on the preview should show no ack warnings. On an Alchemy upgrade, inspect `EventSourceLive`, drop the patch if upstream settles only unsettled messages, and rerun the native suite. No upstream issue has been submitted.
