# Delivery status

Status as of 3 November 2026. The whole-repository cleanup (milestones C0–C7) is done. C8's review fixes and the
signed-picture follow-up passed the full gate and are deployed to the isolated preview; the remaining authenticated,
phone/desktop and live-provider acceptance below is still open.
Feature work on the 31 October plan (M4–M6, M8–M9) stays frozen until testing starts. The history of every earlier
milestone, with its evidence, is in `docs/archive/STATUS-2026-10-28-to-2026-11-02.md`.

## Eva review document (3 November)

The independent [review tracker](https://styld-review-07c26b483ccc.pages.dev) is published on Cloudflare Pages.
It contains 51 findings, 21 ticket drafts, 35 screenshots, eight workstreams and preliminary code-review notes.
The owner approved public access, including the screenshots, and then authorized an easy-fix batch. Direct Ask
entry, piece edit clarity and camera entry/finish controls are deployed to the isolated preview. Larger capture and rotation work stay
open. Every completed ticket requires matching before/after screenshots; source priorities are not a committed
delivery order. The original code-analysis snapshot is `d73475c`.

Sources and the update/deploy procedure are in `docs/research/eva-review-tracker/README.md`. Shared progress is
stored in `progress.json` and republished to the same URL. Live Chromium checks passed search, filters, reset,
Back, ticket/finding links, all images, JavaScript-disabled reading and layouts from 320px to 1920px, with no
browser errors. The page returns its CSP and noindex headers. The complete repository gate also passed
(753 unit tests, 29 native tests); document-specific evidence is in the tracker's `VALIDATION.md`.
This document deployment changes no Styld application resources or feature acceptance.

## Eva easy-fix batch 01 (deployed 3 November)

- T-13: Ask navigation opens the existing stylist directly with a sparkle icon. Back returns to Wardrobe;
  keyword search remains separately accessible from the Wardrobe header, labelled Search.
- T-15 (partial): back-photo actions and Delete move into Edit, Name is explicitly optional, Category is named,
  and a compact Add to board icon sits beside the piece title. Cancelling deletion retains the draft; saving
  disables deletion. Rotation remains open.
- T-05 (partial): guided cameras precede library upload; the taken count finishes capture, and Finish is more
  prominent. Countdown, timing and no-garment/face suppression remain open.

Baseline screenshots use synthetic fixtures through local workerd and Chromium at 390×844 and 1440×844.
Nine matching before/after pairs are published in the tracker. The full gate and exact-release preview readback
passed on `c05071e`; T-13 is verified, while T-15 and T-05 remain partial. This is not physical-phone or
live-provider acceptance. The tracker retains partial tickets and records evidence separately for each finding.

## Eva board batch 02 (deployed 3 November)

T-04, T-09 and T-11 are implemented together: one Front/Back control with stable selection layers, direct owned-board
editing, Add to board canvas placement, and a category/type piece sheet. Placement uses a versioned D1 batch with
pins and its operation receipt; pin controls wait for pending table saves and uploads. Public board visitors retain
their read-only presentation, and gallery photos remain private. The completed full gate passed (759 unit tests; 29 native tests / 1,284 assertions), as did the final
screenshot harness (49 assertions). Six matching pairs were visually reviewed at 390 and 1440px. Release `021dabe`
was deployed and passed exact-release smoke acceptance (3 tests / 42 assertions). T-04, T-09 and T-11 are
verified. Physical-phone and live-provider acceptance remain separate.

## Eva camera batch 03 (bounded client fixes deployed 3 November)

A bounded follow-up implements a central cancellable countdown, dark/uniform-frame guards, motion
cancellation and explicit Back pairing. Baseline synthetic Chromium/workerd captures reproduced black-frame
advancement at both 390 and 1440px; matching after captures reject that frame and show the countdown. The full
gate passed (763 unit tests; 29 native tests / 1,202 assertions), as did the screenshot harness (17 assertions).
Four matching pairs were visually reviewed. Release `15ddaca` is deployed; exact-release preview smoke passed
(3 tests / 42 assertions), and F-49 is verified. T-01/T-05 remain partial: foreground
extraction, garment-contour/no-garment recognition, the review card Front/Back preview and real-phone/provider acceptance stay open.
See the tracker's `BATCH-03.md` for the investigation and remaining provider/phone boundaries.

T-21 remains ready for review: all remaining private media routes are migrated and deployed as batch 04 below.
Authenticated deployed media/load, Workers Logs and expiry-refresh acceptance remain open. F-43's slow hero
picture has not been remeasured on an authenticated deployed wardrobe.

## Eva media batch 04 (deployed, 3 November)

T-21 migrates board images, Gallery photos/garments, review detections and turn files to the shared signed-media
handler, removes the private per-kind routes and removes per-image D1 reads from embedded MCP thumbnails.
Generated turn files stream with byte ranges; user photos remain transformed. The full integration gate passed:
670 files / zero type findings, 777 unit tests, 30 native tests / 1,453 assertions. Six matching synthetic
before/after pairs at 390 and 1440px passed capture acceptance (17 assertions) and visual review.

Release `ac535e1` is deployed; exact-release smoke passed 3 tests / 42 assertions. Not verified: signed-in media
readback returned 401 with the available session. Authenticated deployed load/Workers Logs, expiry-refresh
and F-43’s hero-image timing remain open. The four-step sequence and evidence are in the tracker’s `BATCH-04.md`.

## The preview

- **URL:** https://styldappv2-styldedge-preview-le7xsbk4pgfxkm7o.kristjan-grm11775.workers.dev (isolated workers.dev,
  noindex, no custom domain). `/api/health` names the running release.
- **Release:** `ac535e105803a92d1290321cb1cb87221ceb813a`, committed on `main` and deployed on 3 November at
  14:27 UTC. `/api/health`, the API Worker's release binding and the SSR release binding match. This adds media
  batch 04 to bounded camera batch 03, board batch 02, batch 01, C8 and the signed-picture fixes. Later documentation receipts do not change the deployed application SHA.
- **Deployment:** Alchemy reported three successful Worker updates and two release-binding changes; D1, R2, queues
  and Durable Object namespaces were unchanged. The four migrations through `20261102202631_c8_durability` were
  recorded by the preceding preview readback; this batch planned no migration or storage changes.
- **Cloudflare readback:** the edge alone exposes workers.dev; the API and SSR Workers have both workers.dev and
  preview URLs disabled. No custom domains are attached.
  Deployment ids: edge `0c266c3b-bff3-4afb-81f9-71a7a6ffc6cc`, SSR `7ddd2560-4efa-46b7-b926-993b876ec0d0`,
  API `49efd079-16c5-4169-881a-be471376547e` (each at 100%).
- **Rebuilt from scratch** (C5): stage `preview` destroyed and deployed again on the one baseline migration, with
  Alchemy's state in the Cloudflare account's state store (`docs/DEPLOYMENT.md` › Rebuild and import).
- **Testers' wardrobes, last recorded 2 November** (owner-approved, `docs/ARCHITECTURE.md` › Delivery boundary): the owner's 74 v1 pieces were
  imported by the operator importer as 73 pieces plus 1 refused (a 1×1 placeholder picture in v1). The second
  tester's 313 v1 pieces were still importing when this was written; their reconciliation (`exported = ready +
  refused`) is pending.
- **Readback still to record for this release:** the second import's report, every wardrobe row decoding, no
  pending credit holds and idle sweeps in Workers Logs. The automated preview/release check passed as recorded below;
  this deployment did not inspect private wardrobe data or run paid provider probes.

## Gate results

`heavy --wait bun run check` exited 0 for media batch `ac535e1` (3 November): effect-tsrs 670 files,
0 findings; lint and static gates green; 777 unit tests in 121 files; native 30 pass, 0 fail,
1,453 assertions. Gate build budgets passed: initial browser 349,617 gzip bytes, all browser 613,980 and
SSR 1,915,464 source bytes. The release-stamped deployment build also passed the bundle budget check.

Deployed acceptance (`STYLD_PREVIEW_URL=<above> STYLD_EXPECTED_RELEASE=ac535e105803a92d1290321cb1cb87221ceb813a
heavy --wait bun test tools/preview.native.test.ts`) exited 0: 3 pass, 0 fail, 42 assertions. It verified the exact
health/release, auth and CSRF contracts, hydrated website, MCP discovery/challenge/registration and immutable static
assets. Native tests use fake providers; this is not acceptance of real paid-provider outcomes or every signed-in
preview journey. Batch screenshots, scope and review notes are in the tracker's `BATCH-01.md`, `BATCH-02.md` and
`BATCH-03.md` and `BATCH-04.md`. T-21’s authenticated media/load and expiry-refresh acceptance are still open.

## Incident: D1 overloaded by the wardrobe's thumbnails (2 November, fix deployed 3 November)

Workers Logs on `b9cfffe` showed 66 `d1_all` errors "D1 DB is overloaded. Requests queued for too long" and 500s on
`/cdn/pieces/:id/thumb`, `/api/pieces` and `/api/auth/getSession`: each owner picture read the session, the piece and its
picture row from D1, and a wardrobe screen loads 60–80 at once (one account has 313 pieces).

- **Signed picture addresses** (`server/src/kernel/SignedMedia.ts`): HMAC-SHA256 over account, piece, R2 key, content
  type, size, version and expiry; the key is derived from `AUTH_SECRET` under `styld-media-v1` (no new secret).
  Expiry is the next full hour plus 24 hours, so an address is stable for an hour. Only `via: 'session'` gets them;
  an assistant never does. `Piece.images` (`thumb`, `full`, `clean?`, `back?`) carries them in every owner read
  (list, piece, looks' and boards' pieces, which now join their picture row so they show the drawing).
- **`GET /cdn/media/:entityId/:size`** (`wardrobe/SignedImage.ts`) verifies the signature (403 otherwise), reads R2,
  transforms with the Images binding (transformed bytes only), answers `private, max-age=<until expiry>, immutable` and
  keeps a copy in the edge Cache API under the signed URL (the Cache API may do nothing on workers.dev; a miss or a
  failure is never an error). No session, no D1. `/cdn/pieces/…` is gone.
- **Web:** `Cdn.ts` reads `piece.images`; what names a piece by id (tables, Styld's answers, the tray's "already
  have") looks it up in the person's pieces, so Boards and Review now load them too.
- **Evidence:** unit (`SignedMedia.test.ts`: tamper, expiry, other account, other secret, assistant gets none; web
  scenes); native `WardrobeAcceptance`, `CaptureAcceptance` and `CleanPictureAcceptance` updated to load the
  addresses without a cookie and to refuse altered ones; all passed in the full gate. The deployed load improvement
  still needs an authenticated wardrobe readback and Workers Logs.
- **Media follow-up deployed:** batch 04 removed the remaining private per-kind routes and per-thumbnail MCP
  database reads. Authenticated deployed media/load, Workers Logs and expiry-refresh acceptance remain open.

## C8 fixes: credits, paid work and durability (deployed 3 November)

The follow-up remediation passed final integration validation and deployed preview acceptance. Live-provider and
authenticated product acceptance remain open. The forward migration `20261102202631_c8_durability` follows
`credits_paid_work_imports`; it preserves existing generation picks and pictures while rebuilding their parent with
foreign keys enabled (rehearsed by `DurabilityMigration.test.ts`).

- Generation jobs remain `admitting` until credits and the prompt check pass, resume by their exact operation
  receipt, and expire after 30 minutes. Only the admission that wins its failure transition can undo its job.
  Mood-board planning keeps a durable result and conditional picks; competing deliveries leave the winner alone.
- Replaying a settled Wallet reservation cannot authorize new paid work. Settlement records survive account-row
  deletion. Paid-attempt results are retained until explicitly forgotten or their account is removed.
- Imports keep a copy intent before R2 writes, adopt it atomically, and claim discard before deleting abandoned
  copies. Closed accounts cannot adopt or process imports. Import starts keep their operation IDs; the CLI's
  `--retry-failed` starts a fresh run and failed pieces become processing before queue submission.
- Capture/photo result application is fenced by the active claim. Video upload is claimed before calling Meta;
  uncertain upload outcomes are not replayed, and known file IDs are recorded independently of capture rows.
- Making content private preserves moderation enforcement. Search revisions reject stale responses and timers;
  URL restoration preserves in-progress spaces. Board creation retries reuse their operation and original name;
  save-to-board ignores duplicate submissions. Failed saved-content and piece-look reads offer retry. API-client
  loading retries failures and shares successful loads; locale loading fails visibly before persisting a change.

From the two C8 reviews of `56a619b`, each with a test (unit on the SQLite D1 harness, layer tests with the
in-memory Wallet, or native):

- **Concurrent requests never settle another's hold:** a redraw, a turn and a capture retry claim their attempt with
  a conditional D1 write before reserving; a loser holds nothing and answers busy (`PaidClaims.test.ts`; the native
  redraw and first-turn checks race two requests).
- **Paid work runs once** (`usage/Attempts.ts`, table `paid_attempts`): piece and back cut-outs, gallery finding,
  capture processing and Styld's replies claim the work, store its result and resume from it on a redelivery; a live
  claim is left to its delivery; a claim whose delivery died past the 15-minute lease is an unknown outcome, refunded
  and never sent again (`PaidAttempts.test.ts`).
- **`once()` claims the operation id** with a pending receipt before its work (`operation_receipts.result` nullable);
  paid callers resume a request that died rather than run it again; `saveReceipt` refuses a competing receipt
  (`Receipts.test.ts`).
- **Durable settlement** (table `pending_settlements`): every hold is recorded before it is reserved and kept until
  the Wallet confirms; the `settlements` sweep settles recorded endings and refunds a hold whose work never ended
  after 6 hours, whatever the content's status (`Settlements.test.ts`). `failPiece` refunds before leaving
  processing; deleting a photo while finding refunds it; the generation sweep's one-hour re-settlement is gone.
- **Veo:** an accepted start whose answer cannot be read is `OutcomeUnknown` (refunded, never resent).
- **Gallery person cut-out:** asked once per photo, the outcome (including no person) kept, 6 a minute per account.
- **Uploads:** 300 paths a minute per account (a video part's stills are about thirty uploads), at most 100 uploads or 512 MiB waiting unused; the unused sweep forgets
  500 expired paths and 500 unused uploads per run, rows before objects.
- **Importer:** a permanent `(account, v1 id)` mapping (`imported_pieces`) instead of expiring receipts.

## Gates

`heavy --wait bun run check` runs, in order:

- `format:check` (oxfmt).
- `agents:check` (repoagents): the vendored skills in `.agents/skills` and the harness links and MCP files.
- `vendor:check` (`tools/vendored.ts`): the `repos/` snapshots, the `FOLDKIT.md` copy and the anti-slop lint rules'
  file hashes. It is the one vendored-hash gate; `provenance:check` is gone.
- `icons:check`, `assistant-views:check` (generated files match their sources).
- `translations:check` (x18n): key parity between en and sl, missing translations, unused keys (errors), hard-coded
  strings.
- `i18n:check`: ICU syntax, argument and plural parity, approved rich tags, the generated catalog modules.
- `graph:check` (package boundaries), `patterns:check` (`tools/patterns-check.ts`, ARCHITECTURE › Patterns),
  `style-tokens:check`, `suppressions:check` (the census of reviewed suppressions only), `canaries:check`.
- `typecheck`: effect-tsrs (TypeScript and Effect diagnostics) over the one root `tsconfig.json`; the planned web/workers
  split is not done (Open items).
- `lint`: type-aware Oxlint with anti-slop; no explicit `any`, no non-null assertions, cyclomatic complexity ≤ 20,
  cognitive 15, function and file size limits.
- `unused:check`, `unused:production` (Knip; the gates are entries through `package.json`, the operator scripts are
  listed one by one in `knip.config.ts`, so a script nothing runs is reported).
- `duplicates:check` (jscpd).
- `build`, then `bundle:check` (reads that build), `test:unit`, `test:native:built` (workerd + Chromium through the
  real edge, on the same build).

## What is built

Each line is a kept feature; `docs/DELIVERY.md` maps it to the tests and readbacks that prove it.

- **Sign-in:** one six-digit email code for sign-in and sign-up; logout; account deletion (recorded as access ends,
  public content hidden at once, every store purged by the queue or the account sweep, a last prefix purge a day
  later); admins by sign-in email (`STYLD_ADMIN_EMAILS`).
- **Adding clothes:** photos from the picker; the "hold it up" and "lay it out" cameras (Clef fires the
  shutter, front then back); videos up to 15 minutes cut into parts on the phone; add from a shop's page.
- **Cut-outs:** one garment pipeline (`capture/Garments.ts`): Clef routes, Cloudflare Images cuts out one garment, SAM
  splits several; a pair of shoes is one piece; a garment seen across a video is one card.
- **Review tray:** keep, drop or keep the original photo; "Already in your wardrobe?" matching; only a person turns a
  detection into a piece (assistant adds skip the tray).
- **Clean pictures and the turn:** Muse draws a clean picture from each kept cut-out (free), redraw with a hint
  (1 credit), the real photo one tap away; the quarter-turn on a hanger (Veo, 5 credits).
- **Wardrobe:** 29 shop-style types in three groups, season, occasions, pattern, brand and shop link (Clef suggests);
  group tabs, type chips, a dense grid and a filter sheet.
- **A piece's page:** front and back (add or replace the back), facts, edit, delete, "In your photos" and "In your
  looks".
- **Today (Home):** today's outfit from the outfit engine with Spin and Wear this (worn days), Pick up where you left
  off, From people you follow.
- **Outfit engine:** Fast (rules propose, Clef ranks) and Thinking (a text model proposes, rules check, Clef ranks),
  Thinking at most 50 a day; measured per mode in Analytics Engine (`tools/ai-usage-report.ts`).
- **Looks:** made by the assistants, by Styld or from a photo; listed, opened, shared one at a time and deleted.
- **Boards:** a grid of pins (pieces, looks, pictures, others' public pieces, credited) with a hand-edited collage
  (move, pinch, turn, layer, label, undo, save as a look); Save to board from pieces, looks and photos.
- **Stickers and mood boards:** a sticker drawn from words (1 credit, marked Generated); a mood board of the person's
  own pieces from one sentence, pinned and laid out (1 credit).
- **My Gallery:** the person's own outfit photos (1 credit to find the clothes), matched to pieces, favourites, Wear
  it again, Add to board (held back from visitors), Cut out the outfit, a missing garment offered to the tray.
- **Styld, the stylist:** a chat at `/ask/stylist` over the person's own pieces and looks (DeepSeek V4.1 Flash on
  Workers AI), 1 credit a message, back when no reply comes.
- **Public profile and social:** `/@handle` with Boards and Looks; public boards, looks and pieces with share links
  and link previews; Save, one-way private Follow, Block, Report; readable signed out.
- **Explore and search:** Edits from Styld, featured boards and people, newest by mood; Ask searches the wardrobe,
  people and boards.
- **Safety:** every public item is checked first (Clef for pictures, Llama Guard 3 for words); unsure stays out of
  discovery, failed is hidden with a notice; three reports hide; admin MCP tools hide, restore and feature.
- **ChatGPT and Claude (MCP):** OAuth (CIMD and DCR), consent and immediate revoke at `/mcp`; noun_verb tools over
  the same operations; MCP Apps views (the wardrobe and a board) inside the host.
- **Credits:** 100 a day per account (`protocol/Prices.ts`), held before paid work and settled once; a lost provider
  answer refunds.
- **Languages and telemetry:** English and Slovenian everywhere; browser telemetry only after consent.
- **Operator tools:** the v1 importer (`tools/import-v1/`, admin `POST|GET /api/admin/imports/:id`), the AI usage
  report, the live provider probe.

## C8 review fixes (safety, contracts, deletion, privacy, gates)

From the two reviews of `56a619b`; included in release `8ff72e7`. Preview D1 records migration
`20261102150114_deletions` and the subsequent credit/durability migrations as applied.

- **Safety judge fails closed:** a Llama Guard answer in neither of its formats, or an empty one, is Broken and leaves
  the check pending (re-queued, then swept); Workers AI's answer schema refuses `{}` and empty messages.
- **Writes keep their operation id:** profile edits and publishing, saves, follows, blocks, piece edits, back removal,
  picture choice, look sharing, board edits and visibility and worn days write their receipt in the mutation's batch
  (`kernel/Receipts.ts` `recorded`); a repeat writes nothing; changed input is `OperationConflict`, declared on the
  endpoints and enforced by `protocol/test/Api.test.ts`.
- **Derived link fetch ids** are a digest of the whole parent id and the tool.
- **Account deletion is durable** (`account_deletions`, the `accountDeletions` sweep); public profiles, boards, looks
  and pieces of a closing account are hidden at once (`social/ProfileStore.ts` reads only open accounts).
- **Videos at Meta** are recorded (`provider_files`) until Meta confirms the delete (or has no such file); the
  `providerFiles` sweep and account deletion delete them.
- **MCP thumbnails** are only transformed images, never the stored original.
- **Link previews** are read as the signed-in viewer (the edge forwards the cookie), so a block hides them too.
- **Save to board** keeps its create-board and pin operation ids and the board it made across a failure.
- **Patterns gate:** HTTP transports only in `providers/` (`providers/PublicWeb.ts` is the public web's), names
  resolved through aliases and namespace imports (`tools/quality/patterns.ts` and its tests).

## C8 browser review fixes

From the live browser review of 2 November (`meta-hackathon/out/styld-c8/browser/findings.md`, F1–F9); unit, scene
and native evidence, now deployed in `8ff72e7`. The provider-specific readbacks below are still pending.

- **F1 Styld's replies:** the reply's language is decided in code from the person's latest message (the app's when its
  words do not tell) and stated once, so the model never weighs it aloud; earlier shown pieces and saved looks go back
  to the model as the `pieces_show`/`look_get` calls that made them, never as `[shown: …]` notes it copied; what the
  person reads drops bracketed notes (their own pieces among the ids show as cards, others' are dropped), paragraphs
  about "the user", Han/kana/Hangul characters and `<think>` reasoning (`stylist/Reply.ts`, `ai/LanguageModel.ts`).
  Evidence: unit tests with the review's answer replayed through the real turn. Live behaviour of DeepSeek on the
  preview is not yet read back.
- **F2 labels on a tidied board:** labels go centred across the top, never larger than a label drawn within the
  table's width; pieces on a grid below (`protocol/Placement.ts`).
- **F3 board reads** give up after 10 s and are tried once more, then the page offers Try again. The server-side cause
  of the 90-second read was not reproduced.
- **F4 garment names:** the board picker and the collage tray name a piece by its name, else its type and colours.
- **F5 In your looks:** `GET /api/pieces/:pieceId/looks` and the piece page's look cards (native acceptance covers the
  read on D1).
- **F6** the `flats` type reads Low shoes / Nizki čevlji; Styld's Slovenian note says the same.
- **F7 first outfit:** Fast's twelve candidates are judged in one wave and ranking stops at 4 s (unit: three-second
  Clef calls 6 s → 3 s; a stalled Clef answers at 4 s with the rules' order). Live latency not yet measured.
- **F8** the language menu offers English and Slovenian only; pseudo-locales open only through code.
- **F9** Sign out sits under the identity on Account.

## Open items

From C8's browser review: read back F1 (a Slovenian then English chat on the preview) and F7 (POST
`/api/outfits` timing on a cold visit).

From C8's review fixes:

- The Wallet's Durable Object (its state and command receipts) is not purged with the account: Alchemy Domain beta.84
  exposes no way to erase an aggregate's storage, so it needs a dependency patch or an upstream API.
- A video Meta accepted whose response loses its file ID cannot be reconciled without provider support. If the ID
  is returned but both durable recording (after retries) and immediate deletion fail, cleanup is still best effort.

From the cleanup's milestones, still open after the later ones:

- No tool lists pending Wallet holds; `pending_settlements` holds every one the Wallet has not confirmed settled (a
  D1 query reads them), and the `settlements` sweep logs how many it settled.
- C8's credit and durability fixes and migrations are deployed. A live authenticated readback of a redraw, a turn,
  a capture retry, a gallery photo and a cut-out under concurrent requests remains pending; native acceptance with
  fake providers passed.
- The website words a refused upload path (`LimitReached` `uploads`, `SlowDown`) as its generic limit message; the
  catalogs have no upload-specific wording yet.
- The native suite's shared local D1 answers `SQLITE_BUSY` under load; the gallery browser journey ("sideways
  scroll") flakes under box load (rerun alone with `-t "lays out today"`).
- `AccountLifecycle` still takes its bindings as a record (`makeAccountLifecycle`, its tests' seam over a listing
  bucket).
- `mcp/Sdk.ts` still answers the MCP SDK's older protocol era (`answerLegacy`) for external assistant hosts.
- The auth storage tables stay exported from `@styld/db` for Drizzle Kit.
- Styld's turn tests still run on the recorded GLM fixtures (`test/fixtures/stylist/glm-*.json`), not DeepSeek's.
- A Thinking call that times out is retried while busy (up to three more times) inside a synchronous request.
- `capture/Providers.ts` and the stylist's and language model's `(parts) =>` records remain beside the services.
- The garment pipeline's 512 px model input and the pair rule need the fixture comparison and one real photo per
  intent read back on the preview (C4a).
- C7's web/workers tsconfig split is not done: the native suite is one program that imports the server's source and
  runs Playwright callbacks that need the DOM lib, and tsrs has no build mode or project references, so the server's
  stream casts (`CloudflareImages.ts`, `Meta.ts`, `Wardrobe.ts`) stay needed there. Without the DOM lib the server
  source compiles without the `Meta.ts` and `Wardrobe.ts` casts, after small fixes (`crypto`, `import.meta.url`,
  `URL` in `fetch`, a nullable `Response.body`).

From the product (carried from 31 October – 1 November):

- Home waits 4–6 s for its first table while Clef ranks twelve candidates; Thinking takes about 15 s.
- A Workers AI call sometimes hangs on "save that as a look" turns (bounded at 45 s and retried).
- Cloudflare Images answers 9529 ("too busy") in bursts of about 90 cut-outs a minute; the queue absorbs it.
- The runtime's own `r2_get` span reports a judging-picture cache miss as an error, crowding Workers Logs queries.
- My Gallery has no readback on a real worn photo (finding and cutting out a person); favourites are not yet clues
  for the engine or Styld.
- The piece page lacks "Create board" (it comes with M4's templates); link import does not read the brand.
- Not built yet: a composed link-preview image, follows and blocked lists on the website, the "people I follow"
  search filter.

## Owner decisions pending

- **Gate 1:** rate the ~60 calibration outfits (Fast against Thinking) on the rating page; feeds M4.
- **Try-on test (M8):** 2–3 full-body photos of the owner; then go or no-go, provider and price.
- **My Gallery readback:** a worn outfit photo.
- **Labels:** Flats against heels (the owner's Derby shoes are typed heels).
- **Styld:** the model and the price per message.
- **Order of M4–M9** after the testers' findings.
- **Screen review topics:** where Styld lives, what Home is for, credits and settings on Account, Mine/Saved on
  boards, the landing's lead, Sign in with Google.
- **Production:** billing's planning round, legal pages and the cutover to styld.app, each on the owner's go.

## Next

Finish C8's remaining preview acceptance: signed-in browser walks in en and sl on phone and desktop, the explicit
provider/readback gaps above, and each outstanding `docs/DELIVERY.md` row. The review fixes, full integration gate,
preview deployment and automated release readback are recorded above. Use `docs/TESTING-GUIDE.md` for the testers.
