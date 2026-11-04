# Architecture decisions

The decisions in force on 2 November 2026, after the cleanup (C0–C6) and the rebuild. Superseded decisions and the
reasoning trail are in `docs/archive/ARCHITECTURE-2026-11-02.md`; product scope is `docs/ROADMAP.md`.

## Runtime and the public origin

- **One public origin.** A small edge Worker (`packages/server/src/EdgeWorker.ts`) owns the workers.dev URL, serves
  the Foldkit build's static assets itself, routes `/api`, auth, media, OAuth and `/mcp` to the API Worker and pages to
  the Foldkit SSR Worker over service bindings. The API and SSR Workers have no public URL. Foldkit's generated SSR
  entry is unmodified. The edge injects title and Open Graph tags for public URLs (SSR runs no Commands) and sends
  `X-Robots-Tag: noindex` on stages that may not be indexed (never a `robots.txt` disallow, which would stop
  link-preview crawlers).
- **Stages** (`packages/server/src/Resources.ts` › `stages`): the stage name decides `STYLD_ENV`, robots, the
  Analytics Engine dataset and the Workers RateLimit namespace block; `preview` is deployed, `production` is defined
  for the cutover, `local` and `local-native` run on this machine; any other name stops the plan. Alchemy owns all
  infrastructure and keeps its state in the Cloudflare account's state store (`docs/DEPLOYMENT.md`).

## The API Worker: a list of modules over one kernel

- **Modules** (`server/src/Modules.ts`): platform, account, social, wardrobe, capture, photos, generation, outfits,
  links, stylist, mcp, imports. Each is one value (`kernel/Module.ts`): `{ layer, api?, routes?, consumers?, sweeps? }`.
  `StyldWorker.ts` builds the kernel once per runtime from the Worker's bindings and every module over it, and checks
  at the type level that no module needs a service nobody provides. Adding a module is one entry in that list. A
  module provides the layers of the modules it uses by reference; Effect builds each layer once.
- **Kernel** (`server/src/kernel/`): `Db.ts` (the one drizzle over D1, `query`, `first`, `chunked`, failures as
  `StoreUnavailable` → protocol `Unavailable`), `Ids.ts` (`newId`, `randomToken`, `digestOf`), `Receipts.ts` (operation
  receipts), `Media.ts` (bucket and Images, key listing, paginated deletes, `deleteAfterRows`), `Pacing.ts` (one table
  of paces over RateLimit bindings; a failing limiter refuses), `Metrics.ts` (the provider call counter).
- **Services, not records.** Every module's operations are `Context.Service`s with layers over the kernel; large
  operation groups are built over the services they yield (`Effect.context`), never over hand-rolled dependency
  records. Domain `decide`/`evolve` are pure.
- **Only the owner writes its tables.** Each `@styld/db` table has one owning module (`tools/patterns-check.ts` holds
  the map). Another module's write is a statement the owner exports from its `Rows.ts` (`PieceRows`, `PictureRows`,
  `BoardRows`…) and the caller composes into one D1 batch.

## The contract

- **`@styld/protocol` is the contract** for the website, the assistants and Styld. `StyldApi` applies `/api` once;
  groups are declared one way. Browser code imports contracts, never server adapters.
- **Errors are declared once** (`protocol/src/Errors.ts`): `Unavailable`, `SlowDown`, `NotFound`, `LimitReached`,
  `OperationConflict`, `RequestRefused`, plus Thinking's `ThinkingUnanswered`. Each carries a `guide` annotation (code,
  retryable, message, recovery) from which MCP derives every tool error; the website words refusals from its catalogs.
- **Ids, text, limits, prices, languages** live in the contract (`Ids.ts`, `Text.ts`, `Limits.ts`, `Prices.ts`,
  `Languages.ts`); the website, the server and MCP read the same numbers.
- **Every write names its operation.** All non-GET endpoints take an `operationId`. A repeat answers from its receipt
  (`kernel/Receipts.ts` `recorded` for a write that is one D1 batch, its receipt in that batch; `deleting`; `once`) and
  writes nothing, so a late repeat never undoes a later change; the same id with another input is `OperationConflict`,
  declared on every endpoint that keeps its id (`protocol/test/Api.test.ts` names the few that do not yet). `once`
  claims the id with a pending receipt before its work, so a concurrent repeat waits; a request that died leaves a
  pending receipt that paid operations resume from where the work left things. Receipts are kept 30 days, then swept;
  a v1 import's pieces are mapped permanently in `imported_pieces`, not by receipts.
- **Session handled once:** protocol `SessionAccount` middleware provides `CurrentAccount` and admits every non-GET
  request through the Origin/CSRF check; public pages read an optional visitor.
- **Every row decodes.** The baseline migration (`packages/db/migrations/`) with CHECKs from the protocol's literals,
  foreign keys on every link, NOT NULL where always set and one copy of each fact; a test applies every migration in
  order and compares the live schema with the latest snapshot. Schema changes after the baseline are new migrations
  (the first: `account_deletions` and `provider_files`); a rewritten history means destroy and rebuild.

## Credits, jobs and sweeps

- **Credits are reserved before paid work and settled once** (`server/src/usage/Holds.ts`): `holdId(kind, entity,
  attempt)` names every hold; paid work held per attempt settles once its result is stored. Success consumes; a known
  failure or a **lost provider answer refunds** (owner, 2026-11-01). A request claims its attempt (a conditional D1
  write on the row it moves) before it reserves, so only the owner of a hold settles it. Every hold is kept in
  `pending_settlements` from before it is reserved until the Wallet confirms it settled: the first ending recorded
  stands, the `settlements` sweep settles what the Wallet could not take, and a hold whose work never ended is refunded
  after 6 hours, whatever became of the work's rows.
- **Paid work runs once** (`server/src/usage/Attempts.ts`, `paid_attempts`): work a queue may deliver twice (cut-outs,
  finding garments, captures, Styld's replies, a gallery photo's person) is claimed by one delivery, which stores its
  result; a repeat resumes from the result, a live claim is left to its delivery, and a claim whose delivery died past
  the 15-minute lease is an unknown outcome: refunded, never sent again. A claim is released only when the work failed
  before the provider could have taken it.
- **The Wallet** (Alchemy Domain on a SQLite Durable Object per account, `packages/domain/src/Wallet/`) owns only the
  daily credit pool and its reservations: `dailyCredits` (100) per UTC day, unused credits do not carry over.
  `WalletCommandIds.ts` is the only place Wallet command ids are derived. There are no subscription or purchased pools
  (billing gets its own planning round).
- **Work lifecycles are D1 rows driven by queues**, not Domain aggregates: captures, pieces' pictures and turns,
  gallery photos, generation jobs, Styld's turns, imports. `jobs/Jobs.ts`: every queue body is a tagged union consumed
  one way (done acks, failures retry until the last attempt, which gives the job up; an unknown body is dropped; one
  `Styld.Job` log line per delivery). A patch to Alchemy's queue EventSource settles only messages the handler left
  unsettled (`docs/dependency-patches.md`).
- **Nothing stays pending forever** (`jobs/Sweeps.ts`): each sweep runs isolated (one failure skips none), finds stuck
  rows oldest first in batches of 50 over `(state, updated_at)` indexes, and gives them up through their owner after
  their patience; generation jobs are re-sent; unused uploads, old receipts, expired OAuth assertions and checks of
  gone targets are forgotten.
- **Media goes with its owner:** rows first, then every object nothing else shows (one in-use check, paginated
  deletes).

## Styld's chat

- **Yielded Agent hosts the stylist** (owner, 3 November 2026): one Thread per chat, id `<accountId>--<chatId>`, which
  owns the chat's canonical history, admission idempotency (key = the message's operation id, principal = the account),
  recovery and live text. Durable reactions are Yielded's, not a queue's: the reply loop, its retries and its
  unknown-outcome handling are the Thread's.
- **Its own Worker** (`stylist/ThreadWorker.ts`): Alchemy's Effect Worker cannot export effect-cf's Thread Object
  class, and hosting it inside an Alchemy Durable Object would give the alarm two owners. The API Worker calls the
  Thread Worker's entrypoint (admit, chat, live) rather than binding its Objects: an Object reached through another
  script's namespace binding does not know its name, which Yielded requires.
- **One place runs tools and settles credits:** every tool call of a Thread runs in the API Worker (`stylistTool`), the
  same assistants' tools MCP serves; the Thread's lifecycle outbox reports each reply's ending to `stylistSettled`,
  which settles the message's hold once. The chat list per account is D1 (`stylist_chats`); messages and cards are
  read from the Thread's records, never stored twice.

## Providers and configuration

- **Providers** (`server/src/providers/`): Clef (Workers AI) routes, describes, judges and ranks; Cloudflare Images
  re-encodes every upload (EXIF and location stripped) and cuts out single garments; Meta SAM 3.1 splits several
  garments and tracks video; Meta Muse draws clean pictures and stickers; Veo (through the AI Gateway) makes turns.
  Text models go through Effect's `LanguageModel` over the paid LiteLLM gateway (`ai/LanguageModel.ts`): one isolated
  Alibaba Model Studio DeepSeek V4.1 Flash alias serves Styld, Thinking, mood-board planning and text moderation.
  Styld's replies stream over the same transport (Server-Sent Events, usage in the last chunk) from its Threads.
  Clef remains the Workers AI visual judge and garment/attribute model.
- **Every call goes through `providerCall`** (`providers/Call.ts`): a deadline from one table, one `ProviderError`
  with reason `Refused | Busy | OutcomeUnknown | Broken`, retries only while `Busy`, counted into Analytics Engine and
  priced from one cost table (`providers/Costs.ts`). Paid HTTP text calls treat gateway timeouts, server failures,
  lost responses and unreadable completions as `OutcomeUnknown` and never resubmit them. `fetch` appears only in
  `providers/` (gated).
- **Configuration is deployment facts only** (`server/src/Config.ts`): stage, release, origin, auth secrets, admin
  emails, Meta's and the gateway's keys, decoded once. Model ids, thresholds, prices, the allowance, paces and which
  provider does which task are constants in their owning module; changing one is a commit. **No feature flags, no
  switches, no stand-ins in `src`:** tests swap layers (`test/NativeWorker.ts` passes `test/fakes/*`), never env.
- **No compatibility code:** no tolerant decoders for older shapes, no re-exports or aliases, no legacy routes. The
  MCP SDK's older protocol era stays served for external assistant hosts.
- **The real photo is the source.** Generated pictures (clean pictures, turns, stickers) are presentation beside it
  and marked. A picture where a face may show is never sent to Muse; original photos never leave Styld (try-on's
  exception in ROADMAP is not built).

## Authentication and MCP

- **Yielded Auth** with stateful sessions and no positive cookie cache: logout, disablement and security-revision
  changes take effect on the next request. Email sign-in is one six-digit code for sign-in and registration
  (`packages/auth/src/EmailEntry.ts`); mail goes out after the response through `waitUntil`. Password attempts use
  atomic D1 token buckets keyed by HMAC; password sign-up is refused. Account deletion is application-owned and
  durable (`AccountLifecycle`): the batch that ends access records the deletion (`account_deletions`), the account's
  public content is hidden from that moment, and the queue and then the account sweep purge the prefix, the chats, the
  videos at Meta and the rows until done; the record waits a day for writers admitted before it, purges the prefix a
  last time and goes. The Wallet's Durable Object is not purged yet (STATUS › Open items).
- **MCP** at `/mcp`: Styld is its own OAuth issuer (one scope, `styld`), bearer-only, CIMD first with compatible DCR,
  HTTPS or loopback redirects, consent re-read and immediate revoke. Tools are `noun_verb` projections of the same
  operations, inputs are the protocol's payloads, closed, and refusals name the bad argument without its value. Admin
  tools appear only in the admin list, chosen per request by the account's verified sign-in email
  (`STYLD_ADMIN_EMAILS`). Anything other people wrote is data for the assistant, never instructions.

## Visibility, checks and social

- **Visibility has one predicate per level** (`social/Visibility.ts`): `link` (a profile and its links) and
  `discovery` (What's new, search, the landing's boards, the assistants' Explore), applied by every public read, page, feed, search result, MCP answer and pin,
  with blocks both ways. The owner always reads their own content. A piece is public only while it is on a public
  board or a shared look; original photos, tray items and My Gallery photos are never public.
- **Checks have one writer** (`safety/Checks.ts`): content goes pending with its digest right after the change; a
  result is written only while the digest still matches. The judge reads only what others would see. No human queue;
  admins act through admin MCP tools; a report re-runs the check on the content itself.
- **What's new is a query over everyone's public things** (followed people first on each page), not a written activity
  table. Public media has its own routes; visibility is
  checked before any cache, the stored original is never served, a failed transform answers 503.
- **Rate limits** are Workers RateLimit bindings (10 or 60 second periods), one pace table (`kernel/Pacing.ts`).

## Wardrobe, outfits and boards

- **A garment type is one column**; its group and its place in an outfit are total functions of the type
  (`protocol/src/Garment.ts`), never stored.
- **One garment pipeline** (`capture/Garments.ts`, rules in `GarmentRules.ts`, bars in `Policy.ts`): route, cutter,
  prompts, mask selection, caps, description and the pair rule (a pair of shoes is one piece), shared by the tray, a
  piece's own photo, My Gallery and video. Every model input is one 512 px picture (`packages/imaging`).
- **The outfit engine is stateless:** a make takes mode, purpose, anchor, locks and what was seen, and answers a ranked
  batch; Keep is the only write. Rules validate every proposal, whichever mode made it; a failed Thinking call is an
  error that offers Fast, never a silent fallback. Makes and keeps are measured per mode in Analytics Engine.
- **Outfit photos are not captures:** My Gallery has its own tables and offers a missing garment to the tray as a
  capture of its own.
- **Board jobs share one lifecycle:** stickers and mood boards are `generation_jobs` kinds with the same hold, sweep
  and resume. The collage is Foldkit with no canvas library.

## Website, localization and observability

- **Foldkit** owns Model/Message/update/view/Commands; views are pure, updates emit named Commands, request state uses
  explicit schemas. Rendering receives locale, version, time zone and a stable reference time. Styling is zyzz with the
  Gallery tokens (`DESIGN.md`).
- **en/sl catalogs** in `@styld/i18n` over cached `intl-messageformat`, reviewed in Git; the browser loads only the
  page's language. x18n owns key parity, missing translations, unused keys and hard-coded strings; `tools/i18n-check.ts`
  owns ICU syntax, arguments, plural forms and the generated modules. API errors use typed codes; presentation
  localizes.
- **Observability:** native Cloudflare logs and traces (`headSamplingRate: 1` on the preview), Effect named spans,
  structured logs per request, a correlation id on every response. Logs and spans omit tokens, signed URLs, prompts,
  images and raw user bodies. Browser telemetry loads only after consent (`styld_diagnostics` cookie) and posts to a
  same-origin relay (`BrowserTelemetry.ts`) that allowlists and caps attributes; server spans record the browser
  trace id from a validated `traceparent`. Sampled telemetry is not the usage ledger.

## Gates

Each pattern above has a gate in `bun run check` (`docs/STATUS.md` › Gates): `patterns:check` (drizzle only in the
kernel, `fetch` only in providers, `env` only in Config/Resources, no `'x' in y`, no stand-ins, table ownership),
`graph:check` (package boundaries), type-aware lint with anti-slop and complexity limits, the suppression census,
Knip, jscpd, the schema snapshot, unit and native tests and the bundle budget. Each concern has one owning gate:
vendored hashes `vendor:check` (skills: repoagents), `any` and `!` lint, catalog keys x18n, ICU contracts
`i18n:check`, TypeScript and Effect diagnostics `typecheck`.

## Delivery boundary

- Only isolated v2 Cloudflare resources and a workers.dev preview; no production DNS, mail records or v1 provider
  resources are touched; v1 stays untouched and read-only.
- **Personal data in the preview:** the owner approved importing two testers' own v1 wardrobes (their own pieces and
  pictures, read-only from v1, by the operator importer in `tools/import-v1/`) into their own accounts on the isolated
  preview, private to those accounts and never public. Nothing else from production is copied, and no other person's
  data. Exports stay in a private folder outside the repository.
- The production cutover re-runs the same rebuild and importer against `--stage production` on the owner's go.
- The Domain model is checked by `Domain.verify(Styld)` (exported since `2.0.0-beta.85`) and by building the real
  model in a story test.
