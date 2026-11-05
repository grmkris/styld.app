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
  links, stylist, feedback, mcp, imports, seed, billing. Each is one value (`kernel/Module.ts`): `{ layer, api?, routes?, consumers?, sweeps? }`.
  `Application.ts` builds the kernel once per runtime from the Worker's bindings and every module over it, and checks
  at the type level that no module needs a service nobody provides. Adding a module is one entry in that list. A
  module provides the layers of the modules it uses by reference; Effect builds each layer once. The entry,
  `StyldWorker.ts`, keeps only the runtime, the bindings (`Bindings.ts`) and the deployment, and imports
  `Application.ts` and the live providers on the Worker's first event: evaluating the whole module graph at startup
  took about a second of CPU, Cloudflare's startup limit (`ScriptStartupError`, 4 November 2026). That shared import
  only evaluates code; everything that does I/O is built per request by `onFirstUse`.
- **Kernel** (`server/src/kernel/`): `Db.ts` (the one drizzle over D1, `query`, `first`, `chunked`, failures as
  `StoreUnavailable` → protocol `Unavailable`), `Ids.ts` (`newId`, `randomToken`, `digestOf`), `Receipts.ts` (operation
  receipts), `Media.ts` (bucket and Images, key listing, paginated deletes, `deleteAfterRows`), `Paces.ts` (one table
  of paces over RateLimit bindings) and `Pacing.ts` (their service; a failing limiter refuses), `Metrics.ts` (the provider call counter).
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
- **The Wallet** (Alchemy Domain on a SQLite Durable Object per account, `packages/domain/src/Wallet/`) owns the
  spendable credits and their reservations: each UTC day's allowance (unused credits do not carry over) and the
  account's one-time free credits. `WalletCommandIds.ts` is the only place Wallet command ids are derived. A
  reservation brings the day's allowance (the members' 500 while a plan is active, 0 without one) and the one-time
  grant (`freeCredits`, 3); the Wallet keeps the allowance the day was granted and a larger one the same day adds the
  difference, so a plan bought mid-day counts at once. It never stores a plan's end.
  The free credits (owner, 4 November 2026: "a new account gets 3 free credits once") are a second balance in the
  Wallet's state, `free`, that never resets. There is no separate grant command: the grant is the absence of `free`,
  and the first reservation that brings `freeCredits` records it (`CreditsReserved.freeAfter`), so it is idempotent
  and deterministic per account by construction, and every Wallet written before the change (old events and snapshots
  have no `free`) gets all 3 once. The day's allowance is spent first (tomorrow replaces it anyway), then the free
  credits; a reservation records how many came from the free ones (`fromFree`), and a refund returns each part where
  it came from: the day's only on the same day, the free ones on any day. Old events without `fromFree`/`freeAfter`
  replay exactly as before (`Wallet.story`).
- **Payments** (`server/src/billing/`, plans through Dodo Payments as merchant of record; owner, 4 November 2026):
  Week ($4.99 once, 7 days, extending from the current end), Monthly ($20) and Yearly ($200) subscriptions, and
  Lifetime ($349 once), each giving 500 credits a day while active (`Prices.ts` › `plans`). The website opens Dodo's
  hosted checkout for a plan (`POST /api/billing/checkout {operationId, plan}`, the account id in its metadata,
  discount codes allowed) and Dodo's customer portal (`POST /api/billing/portal`, from the customer id the webhook
  stored); only Dodo's webhook gives or moves a membership. `POST /api/billing/dodo/webhook` is a raw route (the
  signature covers the body as sent), verified the Standard Webhooks way with WebCrypto; a delivery counts only for
  one of the stage's four products (`Resources.ts` › `billing.products`). D1's `memberships` row (plan, `until`, none
  for lifetime, status, subscription and customer ids) is the single writer of the entitlement; `purchases` (keyed by
  Dodo's payment id) is the receipt of each one-time payment. A week's or lifetime's `payment.succeeded` is one D1
  batch whose statements check the purchase row themselves, so it counts once; its amount is never checked (a week paid
  in full by a discount code is a week). A subscription's own payments are left to its events:
  `subscription.active`/`renewed` (and `plan_changed` while active) set `until` to the next billing date plus a day's
  grace, `cancelled` stops renewing and keeps that end, `expired`/`failed`/`on_hold` end it at once. Those events carry
  absolute facts, and each applies only when it happened no earlier than the last one applied (`subscription_event_at`,
  Dodo's own time), so a retry or a late delivery never undoes a newer one. A refund or a lost dispute takes back what
  its one-time payment gave, once: a week comes off the end, never before now; a lifetime ends now. A subscription
  payment's refund moves nothing by itself; the subscription's own ending events do. A lifetime membership is never
  moved by a week or a subscription. The delivery's account is the checkout's metadata account, else the subscription
  Styld already knows, else the customer's email (v1's order). The operator grants lifetime by email
  (`POST /api/operator/memberships`, `tools/grant-membership.ts`). `billing/Membership.ts` › `allowanceAt` is the one
  rule that turns the membership into the day's allowance, for holds, the tray and `GET /api/credits`. A stage without
  Dodo's key and secret sells nothing (no checkout, portal or webhook); its mode and products are stage facts.
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
  deletes). A deleted piece's or photo's own prefix is recorded as owed (`media_deletions`, `kernel/MediaDeletions.ts`)
  in the batch that deletes its row; the request empties it, and the `mediaDeletions` sweep empties what R2 could not.

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

- **What Styld knows about the person** (owner, 4 November 2026; `server/src/taste/`): told and learned, private, all
  of it shown on Account › What Styld knows about you. Told: the occasions they dress for and when the first run was
  behind them (`taste_answers`), and the notes they said yes to keeping (`style_notes`, at most 30, removable), beside
  Show me (`viewer_preferences`, the social module's). Learned is a query, never stored, so every delete reaches it:
  the strongest colours and kinds in 90 days of worn days, kept looks and favourite Gallery photos, and the aesthetics
  of saved boards' tags, positive only (avoiding comes only from notes). Each reply's instructions carry it as data,
  Show me as which boards come first and never who the person is; Styld asks before it remembers and writes a note
  with `note_add` only after a yes. Thinking hears likes and notes; a day's outfits asked for no occasion take the day's
  occasion from the occasions they dress for (in the engine, so Home sends nothing new); What's new puts what shares
  their saved boards' aesthetics first on each page, within Show me's bands. A taste that cannot be read just now is
  left out, never waited on.

## Providers and configuration

- **Providers** (`server/src/providers/`): Clef (Workers AI) routes, describes, judges and ranks; Cloudflare Images
  re-encodes every upload (EXIF and location stripped) and cuts out single garments; Meta SAM 3.1 splits several
  garments and tracks video; Meta Muse draws clean pictures and stickers; Veo (through the AI Gateway) makes turns.
  Text models go through Effect's `LanguageModel` over one Chat Completions transport (`ai/LanguageModel.ts`,
  `providers/Text.ts`); each text model names its provider (`providers/Costs.ts` › `textModels`), which its errors,
  counts and prices carry. All of Styld's text is Meta's Muse Spark 1.3 Standard on Meta's own API (`meta-spark`,
  owner, 5 November 2026; `Text.ts` › `metaTextCompletions`, with Meta's key): Thinking, mood-board planning and text
  moderation ask it for JSON objects from the API Worker, and Styld's replies stream from its Threads
  (`providers/StylistModel.ts`, Server-Sent Events, usage in the last chunk). `tools/text-live.ts` probes the three
  object tasks on fixtures before a model, prompt or setting change. Clef (`providers/ClefCall.ts` › `clefOver`, `askClef`; the garment questions in `providers/Clef.ts`) remains the Workers AI visual judge and garment/attribute model.
  A `ProviderError` from a thrown transport or binding error keeps it as its `cause`, never a request or body.
- **Every call goes through `providerCall`** (`providers/Call.ts`): a deadline from one table, one `ProviderError`
  with reason `Refused | Busy | OutcomeUnknown | Broken`, retries only while `Busy`, counted into Analytics Engine and
  priced from one cost table (`providers/Costs.ts`). Paid HTTP text calls treat gateway timeouts, server failures,
  lost responses and unreadable completions as `OutcomeUnknown` and never resubmit them. `fetch` appears only in
  `providers/` (gated).
- **Configuration is deployment facts only** (`server/src/Config.ts`): stage, release, origin, auth secrets, admin
  emails, Meta's and the gateway's keys, decoded once; the Thread Worker's stage, release and Meta key are decoded by
  `threadDeploymentOf`. Model ids, thresholds, prices, the allowance, paces and which
  provider does which task are constants in their owning module; changing one is a commit. **No feature flags, no
  switches, no stand-ins in `src`:** tests swap layers (`test/NativeWorker.ts` passes `test/fakes/*`), never env.
- **No compatibility code:** no tolerant decoders for older shapes, no re-exports or aliases, no legacy routes. The
  MCP SDK's older protocol era stays served for external assistant hosts. An address's query parameters are read
  leniently, as links anyone writes (Website, below), which is not a decoder for an older shape.
- **The real photo is the source.** Generated pictures (clean pictures, turns, stickers) are presentation beside it
  and marked. Cut-outs are sent to Muse without a face check (owner, 4 November); original photos never leave Styld except a
  try-on's: the person's own My Gallery photo they said shows them (`generation/TryOnShared.ts` `sendable`).
- **The house accounts' exception** (owner, 4 November; ROADMAP `#house-boards`): `@styld.women` and `@styld.men`
  show garments generated with Muse Image, one picture per piece, imported with `piece_provenance` marking them
  generated. They are never redrawn, are shown marked Generated wherever others see them, and never touch a person's
  own wardrobe, captures or pictures. The `seed` module (operator only, `STYLD_HOUSE_EMAILS` only) builds their
  profiles and boards through the app's own services, once per catalogue entry (`seeded_boards`). Try with my
  wardrobe (`boards/Try.ts`) lays a house board out again as a private board of the person's own pieces.

## Authentication and MCP

- **Yielded Auth** with stateful sessions and no positive cookie cache: logout, disablement and security-revision
  changes take effect on the next request. Email sign-in is one six-digit code for sign-in and registration
  (`packages/auth/src/EmailEntry.ts`); mail goes out after the response through `waitUntil`. Password attempts use
  atomic D1 token buckets keyed by HMAC; password sign-up is refused. Account deletion is application-owned and
  durable (`AccountLifecycle`): the batch that ends access records the deletion (`account_deletions`), the account's
  public content is hidden from that moment, and the queue and then the account sweep purge the prefix, the chats, the
  videos at Meta and the rows until done; the record waits a day for writers admitted before it, purges the prefix a
  last time and goes. The Wallet's Durable Object is not purged yet (STATUS › Open items).
- **Sign in with Google** (owner, 4 November 2026, as on v1): a Google address Google verified is the same person as
  the Styld account of that address. Yielded never links by email, so `packages/auth/src/GoogleEntry.ts` wraps its
  Google preset: before Yielded resolves an unknown Google identity, it is attached (managed persistence's
  `IdentityImports`) to the account of the verified address, or to an account made for it the way email-code
  registration makes one; an unverified address is refused. Claims carry the account's own verified address, never
  Google's current one (admin and house checks read it). Google returns to `/api/auth/callback/google`, v1's path, so
  styld.app's registered redirect carries over; the edge turns a refused callback into `/login?problem=google`. Without
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `AUTH_OAUTH_KEYS`, or when Google cannot be reached as an isolate sets
  up, Google is not offered and email sign-in is untouched.
- **MCP** at `/mcp`: Styld is its own OAuth issuer (one scope, `styld`), bearer-only, CIMD first with compatible DCR,
  HTTPS or loopback redirects, consent re-read and immediate revoke. Tools are `noun_verb` projections of the same
  operations, inputs are the protocol's payloads, closed, and refusals name the bad argument without its value. The
  tools, their views and the toolset live in `server/src/tools/`, which both surfaces serve: `mcp/` is only the
  transport (route, SDK, OAuth policy) and `stylist/` lists the chat's from the same specs. Admin
  tools appear only in the admin list, chosen per request by the account's verified sign-in email
  (`STYLD_ADMIN_EMAILS`). Anything other people wrote is data for the assistant, never instructions.
- **Pictures in assistants:** an assistant never gets a picture's address (`SignedMedia` answers none for `via:
  'assistant'`). Only the `*_show` tools send pictures, to the host's view and never to the model: Images-transformed
  thumbnails (WebP, 480 px, at most 200 KiB each, never an original file) of the account's own objects, collected by
  `withViewThumbnails` (`tools/Thumbnails.ts`). Owner, 4 November 2026: these may include the person's own My Gallery
  photos, a try-on's before photo and its result. Other people's media never enter a view.

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
- **Rate limits** are Workers RateLimit bindings (10 or 60 second periods), one pace table (`kernel/Paces.ts`, which the entry declares; `kernel/Pacing.ts` checks them).

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
- **The address is the only copy of what a page shows from it** (Foldkit's query-sync, `repos/foldkit/examples/query-sync`):
  the wardrobe's browse and filters, Ask's search and Styld's question live in the parsed route, never also in a
  page's Model. Views read the route; a page's update is given it as a context argument
  (`Wardrobe.update(model, message, { maybeBrowse })`, `Ask.update(model, message, { query })`); a change issues one
  replace built from typed fields (`ReplaceBrowse`, `ReplaceQuery`), and `ChangedUrl` only sets the route. A filter
  or a key replaces the address; a step to another level pushes. Each query parameter is read leniently
  (`WardrobeBrowse.ts`): addresses are links anyone can write or keep, so a value that is not one of ours is left out
  rather than turning the page into Not found, and the address is not rewritten. This is not compatibility code,
  which stays banned for stored and sent shapes.
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
`graph:check` (package boundaries, and the API Worker's layers and allowed cycles in `tools/quality/graph.ts`), type-aware lint with anti-slop and complexity limits, the suppression census,
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
