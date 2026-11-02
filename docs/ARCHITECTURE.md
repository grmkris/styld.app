# Architecture decisions

## Runtime and public contracts

One Cloudflare public origin replaces Caddy and Railway. A small public edge Worker routes explicit API namespaces to the internal Effect Worker and pages to the Alchemy Foldkit Website. Both internal Workers disable workers.dev and version preview URLs. The edge serves the Foldkit build's static assets directly: service-binding fetch bypasses the website's public asset router. Foldkit's generated SSR entry stays unmodified; beta.84 does not support a custom entry with `ssr.build`. The internal Effect Worker owns typed application operations and Domain hosting. HTTP, MCP and durable jobs invoke the same operations. MCP tools are noun_verb projections of the same operations (owner decision, 2026-10-29: v1's published names and arguments are not preserved; `/mcp`, auth discovery and consent/revocation behavior are). Every tool input is closed, refusals name the bad argument without its value, and errors carry a code, a recovery and whether to retry. Preserve public profile/share/link contracts.

## State ownership

D1 with Drizzle owns identity/application relational data, wardrobe, profiles, social/safety, catalogs and ordinary board metadata. Alchemy Domain on SQLite Durable Objects owns credit/usage reservations and generation lifecycle decisions, outboxes and durable orchestration. A domain-owned invariant has no second writable D1 copy. Projections are derived and idempotent. R2 owns media bytes. Vectorize indexes derived embeddings; all search candidates pass current visibility/safety authorization.

Model commands carry idempotency and request hashes. Provider accepted-but-response-lost is an explicit unknown state, reconciled by provider receipt where possible. Usage is reserved before execution, consumed after durable success or refunded once after known failure. Credentials, credit amounts and owner identity never come from trusted browser input.

Domain beta.84 looks up a transport command ID before re-running `decide`. Transport IDs therefore remain server-owned and stable per internal operation. `packages/domain/src/Wallet/WalletCommandIds.ts` is the only place Wallet command IDs are derived; it includes the inputs the Wallet checks for conflicts, so a changed payload still reaches `decide`. The generation request must own public idempotency keys and canonical payload fingerprints; direct public Wallet command access is forbidden. The Wallet retains only pending holds, and its durable receipts prevent a settled operation from being reserved again under its original server-generated command ID. Receipt retention or deletion must preserve that invariant.

Monthly credits roll over up to twice the monthly grant, including held subscription credits. A plan downgrade may reduce unreserved subscription credits but never erases an in-flight hold. Refunds restore the original source pools, preserving purchased-credit ownership.

## Authentication

Yielded Auth is the chosen authentication library. Stateful sessions have no positive cookie cache: logout, account disablement and security-revision changes take effect on the next request. Password attempt budgets use atomic D1 token buckets with database time and HMAC identifier keys; auth runtime recreation cannot reset them. Port anonymous users/merge, email OTP, Google sign-in, sessions, account linking/deletion and MCP authorization with explicit storage adapters. MCP is bearer-only, HTTPS/loopback redirects, CIMD primary and compatible DCR, short-lived access tokens, consent re-read and immediate revoke. Styld is its own issuer (`OAuthServer.make('mcp')`, one scope `styld`) as in the owner's myapps and goblin; deviations from myapps: opaque access tokens for up to 600 s checked against D1 so revocation is immediate, no 30 s refresh grace, issuer = the public origin. Email sign-in is one six-digit code for both sign-in and registration through a Styld strategy over Yielded's code and registration modules (`packages/auth/src/EmailEntry.ts`); code mail goes out after the response through the request's `waitUntil`. Account deletion is application-owned (`AccountLifecycle`): access ends first, then photos, then rows. Dodo customer creation stays lazy at checkout and cannot block sign-in.

## UI and localization

Foldkit owns Model/Message/update/view/Commands. Port Studio interactions, accessibility, gestures, mobile/Safari behavior, public SSR/OG and en/sl. Reuse v1 design assets and reviewed content. Preserve ICU catalogs in `@styld/i18n` over cached `intl-messageformat`; the generator writes one module per language, servers and tests provide both, and the browser loads only the page's language (another one before switching to it); General Translation is optional reviewed authoring only. x18n (`x18n.config.ts`, `bun run translations:check`) manages the catalogs and fails on missing keys, invalid syntax, stale or missing translations and hard-coded strings in application code (style modules, protocol text for assistants and OAuth clients, and the SQL-only persistence modules are exempt); its unused-key count tracks how much v1 copy is still unported. `tools/i18n-check.ts` remains the authority on ICU arguments and plural forms. API errors use typed codes; presentation localizes. No runtime translation calls.

## Providers and cost

Cloudflare image delivery replaces deterministic image transforms. Generative try-on still needs a measured provider. Workers AI candidates are evaluated against garment/person quality fixtures; accepted-result cost includes retries and fallback. A capability router chooses provider/model by task and budgets. No silent downgrade of identity, garment or safety quality. Deployed credentials use application-scoped pay-as-you-go access, never a personal subscription plan that forbids app backends.

## Observability

Native Cloudflare logs/traces are composed once at the host. Effect named spans and typed outcomes carry release/environment/correlation, job and attempt identifiers. Delayed work persists correlation separately from trace identity. Add explicit application metrics and failure/retry/projection/usage alerts. Keep raw personal payloads out of logs. Browser telemetry has an explicit bounded path. Validate failures and context isolation on the actual runtime.

Browser telemetry is Effect-native as well, and nothing is captured until the visitor allows it: a prompt stores the choice in the first-party `styld_diagnostics` cookie (180 days, reopened from the footer), the browser entry grants consent before the first span, and Maple runs with `requireConsent`. `@maple-dev/effect-sdk/foldkit` turns Foldkit Commands into spans grouped under their page load or navigation, with crash and slow-phase spans, and posts OTLP/JSON without an ingest key to the same origin. The API Worker's relay (`packages/server/src/BrowserTelemetry.ts`) accepts only same-origin JSON within a declared 1 MiB, rate-limits each client IP to 120 posts a minute through a Cloudflare rate-limit binding, decodes spans one by one, keeps an attribute and exception-event allowlist with length caps, logs at most 100 spans per request and writes one structured log per span to Workers Logs; browser logs, metrics and the SDK's always-on session events are acknowledged and discarded. Session replay, session rows, visitor IDs, browser storage and Command arguments are off; every URL the SDK sends is reduced to origin and route, and element text is masked. Cloudflare can neither ingest OTLP nor adopt an external trace parent yet, so server request spans record the browser trace ID from a validated `traceparent` (`styld.browser.trace_id`) to join both sides. API Worker requests log through `Logger.consoleStructured` (provided per request, because Alchemy's Worker bridge installs `consolePretty` for every event), so Workers Logs indexes every field.

The initial Worker uses `Cloudflare.Telemetry({ headSamplingRate: 1 })` for acceptance visibility and the platform's invocation logs. Production sampling, retention and alert thresholds are infrastructure decisions, while the usage aggregate remains the financial record. Native local logs are empty for successful requests, so deployed trace/log readback is a required gate rather than inferred from process output.

## Boards, profiles and social (planned 2026-10-30)

Decisions and recorded deviations for the iteration in `docs/ROADMAP.md` (Boards, profiles and social).

- **Visibility has one predicate per level.** `link` (a profile and its links) and `discovery` (Explore, feeds, search) are each one SQL predicate that every public read, page, list, feed, search result, MCP answer and pin uses, with blocks applied in both directions. The owner always reads their own content.
- **Checks have one writer per change.** `safety/Checks.ts` alone writes `content_checks`. Right after the operation that changes public content, it sets the check to pending with the content's digest; a check result is written only where the digest still matches, so an answer about older content is dropped. Deviation from the plan's same-batch write (2026-10-30): the digest covers what a board, profile, look or piece shows across several tables, so it is computed after the write; if D1 fails between the two, the request fails and the earlier verdict stands until the next edit. Model answers decide (Clef for pictures, a Workers AI text model for words); there is no human queue, and admins act through admin-only MCP tools.
- **The feed is a query over follows,** not a written activity table, which would be a second writer of visibility that unpublishing, failed checks and blocks would have to rewrite.
- **Generated pictures** (stickers since 2026-10-31) and mood boards keep their lifecycle in D1 rows driven by a queue, with Wallet holds reserved before each provider call and settled or refunded once, as captures do. The Domain owns only the usage reservations; this is a deviation from "Domain owns generation lifecycles", recorded here.
- **Public media** has its own routes. Visibility is checked on every request before any cache, the stored original is never served, and a failed transform answers 503 rather than raw bytes. Image bytes are not gated by blocks: ids are 128-bit random, and every surface that reveals an id applies blocks.
- **Public pages** read through an API group with no session middleware that reads an optional visitor. The edge injects title and Open Graph tags into the server-rendered HTML for public URLs, because SSR runs no Commands and has no data; link-preview images are drawn with the Cloudflare Images binding.
- **Rate limits** use Workers RateLimit bindings, whose periods are 10 or 60 seconds, so v1's hourly limits become per-minute limits.
- **MCP** renders one tool list for members and one for admins (an email allowlist from config). Admin tools are only in the admin list, chosen per request by the account's verified sign-in email, so a member's call for one answers `unknown_tool`; the curation operations themselves take no admin actor (a deviation from the plan, recorded at M8). A report re-runs the check on the content itself; the reporter's reason is kept for admins (`report_list`) rather than given to the model, which judges content, not accusations (deviation from ROADMAP, M8).
- **The preview stays out of search engines** through `X-Robots-Tag: noindex`, never a `robots.txt` disallow, which would also stop link-preview crawlers.

## Shopping your own wardrobe (planned 2026-10-31)

Decisions for the delivery in `docs/ROADMAP.md` (Shopping your own wardrobe).

- **A garment type is one column.** `pieces.type` holds one of Styld's predefined types; its group and its place in
  an outfit (top, bottom, one-piece, layer, shoes, accessory, and an internal `set` for sportswear, swimwear and
  loungewear) are total functions of the type in `packages/protocol/src/Garment.ts`, never stored, so they cannot
  disagree. "Already in your wardrobe?" compares pieces within a place, not by exact type, so one misjudged type
  does not hide a duplicate.
- **One board, a template and an anchor.** `boards.template` and `boards.anchor_piece_id` (set null when the piece
  goes); a purchase candidate points at its board and a trip is its board's child row, so every fact has one writer:
  boards write the template and anchor, candidates their candidate, trips their trip.
- **The outfit engine is stateless.** Making an outfit takes the mode, the board's purpose, the anchor, the locked
  pieces and the combinations already seen, and answers a ranked batch; Shuffle walks the batch in the browser and
  asks again when it runs out. Keep is the only write: it creates the look and pins it on the board in one D1 batch.
  Rules are the one validator of every proposal, whichever mode made it; a failed Thinking call is an error that
  offers Fast, never a silent fallback that would spoil the experiment's data. Outfits are measured in Analytics
  Engine (`outfit.make.<mode>`, `outfit.keep.<mode>`); an abandoned session is a make without a keep.
- **One text model seam.** The Workers AI chat model wiring lives in `packages/server/src/ai/` and serves Styld,
  Thinking, mood boards and trip plans, with the per-call deadline Styld set.
- **A look may hold one candidate.** `looks.candidate_id` keeps `Look.pieces` a list of owned pieces for every reader;
  a look with a candidate cannot be shared. "I bought it" moves the candidate into the look's pieces in one batch.
- **Candidates are not pieces.** They have their own table, keys and owner-only image route; a candidate from
  someone's public piece references it and is read through the public visibility check on every request, so it
  disappears when its owner stops sharing it.
- **Outfit photos are not captures.** My Gallery (`photos` in code, since "Gallery" names the design) has its own
  tables. Garment finding and matching are shared with capture as functions; the review tray reads only captures, so
  a photo never appears there unless the person offers a garment to the wardrobe. One in-use check guards stored
  objects shared by pieces, photos and candidates.
- **Board jobs share one lifecycle.** Stickers, mood boards and trip plans are `generation_jobs` kinds with the same
  hold, sweep and resume as generated pictures had.
- **Export is drawn, not captured.** The browser redraws a board from its data onto a canvas with same-origin images,
  loaded on demand, so neither the CSP nor the first-load budget changes.
- **Try-on's privacy exception** is the only path that sends a person's own photo to a provider; it never sends
  anyone else's, and garment inputs still pass the face rule.

## Cleanup before the first production release (owner, 2026-11-01)

Feature work is frozen while one pattern per concern replaces what grew one feature at a time; each pattern lands
with a gate that keeps it. Decisions:

- **A lost provider answer refunds the person.** When a provider accepted paid work and its answer is lost, the hold
  is refunded, in every flow; Styld carries the possible provider charge.
- **One baseline schema.** Until the rebuild, migrations only add; the constraining schema (CHECKs from the protocol's
  literals, foreign keys, one copy of each fact) is generated once as a single baseline on a fresh preview, and both
  testers' v1 wardrobes are imported again through the operator importer the production cutover reuses.
- **Release testing happens on the rebuilt preview;** the deploy configuration becomes stage-ready without creating
  another stage.
- **The API Worker is a list of modules over one kernel** (C4e). `server/src/Modules.ts` lists every module; each is
  one value (`kernel/Module.ts`): `{ layer, api?, routes?, consumers?, sweeps? }` — its services, the handlers of its
  `StyldApi` groups, its plain routes, the queues it consumes (`jobs/Jobs.ts` `consumer`) and its sweeps
  (`jobs/Sweeps.ts` `moving`). A module provides the layers of the modules it uses by reference; Effect builds a layer
  once per build, so every service has one instance. `StyldWorker.ts` builds the kernel once per runtime from the
  Worker's bindings (one `Database` over D1, media, queue producers, Styld's chats, credits, pacing, the call counter,
  auth, the deployment, the providers), builds every module over it, and checks by identity that nothing is left
  unprovided but the Worker runtime's Wallet and runtime context. Adding a module is one entry in that list. Operation
  groups too large for one file are built over the services they yield (`Effect.context`, provided to each method once,
  as in `capture/Shared.ts`), never over a hand-rolled record of dependencies. Deviation: Alchemy declares queue
  consumers while it plans the Worker, so a consumer names its queue and the root binds the declared resource to it.
- **Patterns are gated** (`tools/patterns-check.ts`, in `bun run check`): `drizzle(` only in `kernel/Db.ts`; `fetch(`
  only in `providers/` (the edge Worker's service bindings and the MCP SDK's in-process handler excepted); `env.` only
  in `Config.ts`/`Resources.ts` (the plain-TypeScript edge Worker excepted); no `'x' in y` (the edge's `EdgeMeta.ts`
  excepted); no stand-ins in server source; each `@styld/db` table written only by its owner per the script's map (two
  shared writes: the wardrobe sets `piece_pictures.shown`, curation sets `boards.featured_at`).

## Delivery boundary

Deliver an isolated preview at workers.dev, with safe test data and functioning provider paths. No production DNS cutover, destructive v1 migration or personal-data copying into preview. Provide a reconciled export/import rehearsal and documented production migration procedure as part of parity readiness.

The pinned Domain `2.0.0-beta.84` does not export the skill's `Domain.verify(Model)` helper. Building the real model validates definitions through its kernel; a story test checks construction. Follow installed source where the bundled skill describes a newer API.
