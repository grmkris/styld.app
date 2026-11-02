# Delivery status

Status as of 2 November 2026. The whole-repository cleanup (milestones C0–C6) is done and the preview was rebuilt from
scratch on its baseline; C7 (gates and docs) closes now and C8 (review rounds and the release candidate) is next.
Feature work on the 31 October plan (M4–M6, M8–M9) stays frozen until testing starts. The history of every earlier
milestone, with its evidence, is in `docs/archive/STATUS-2026-10-28-to-2026-11-02.md`.

## The preview

- **URL:** https://styldappv2-styldedge-preview-le7xsbk4pgfxkm7o.kristjan-grm11775.workers.dev (isolated workers.dev,
  noindex, no custom domain). `/api/health` names the running release.
- **Release:** `54a6601` (read back from `/api/health`). Later commits on `main` (the R2 REST importer, C7's gates and
  docs) are not deployed yet.
- **Rebuilt from scratch** (C5): stage `preview` destroyed and deployed again on the one baseline migration, with
  Alchemy's state in the Cloudflare account's state store (`docs/DEPLOYMENT.md` › Rebuild and import).
- **Testers' wardrobes** (owner-approved, `docs/ARCHITECTURE.md` › Delivery boundary): the owner's 74 v1 pieces were
  imported by the operator importer as 73 pieces plus 1 refused (a 1×1 placeholder picture in v1). The second
  tester's 313 v1 pieces were still importing when this was written; their reconciliation (`exported = ready +
  refused`) is pending.
- **Readback still to record for this release:** the second import's report, every wardrobe row decoding, no
  pending credit holds and idle sweeps in Workers Logs, and `tools/preview.native.test.ts` with the release check.

## Gate results

`heavy --wait bun run check` exit 0 on `26aa13a` (C7, 2 November): effect-tsrs 628 files, 0 findings; 17 reviewed
suppressions; unit 663 tests in 106 files; native 29 pass, 0 fail; bundle initial 346,504 gzip bytes (budget 357,677),
all 610,441, SSR 1,891,364. Preview readback of release `54a6601` (`tools/preview.native.test.ts` with
`STYLD_EXPECTED_RELEASE`): 3 pass.

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

From the two reviews of `56a619b`; not deployed yet (the next deploy applies migration `20261102150114_deletions`).

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
and native evidence, not deployed yet.

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

From C8's browser review: deploy and read back F1 (a Slovenian then English chat on the preview) and F7 (POST
`/api/outfits` timing on a cold visit).

From C8's review fixes:

- The Wallet's Durable Object (its state and command receipts) is not purged with the account: Alchemy Domain beta.84
  exposes no way to erase an aggregate's storage, so it needs a dependency patch or an upstream API.
- `photo.updatePhoto`, `photo.matchGarment`, `photo.offerGarment`, `photo.cutOut`, `import.startImport` and
  `capture.turnSheet` take an operation id they do not keep yet (named in `protocol/test/Api.test.ts`).
- A video Meta accepted whose capture row then failed to record its id is not in `provider_files`.

From the cleanup's milestones, still open after the later ones:

- An import run again after its receipts expire (30 days) would import the same pieces again.
- No tool lists pending Wallet holds; the readback reads them from Workers Logs and the sweeps.
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

C8: reviewer rounds (architecture and tooling; security, privacy and durability; the browser product in en and sl at
phone and desktop), fixes, the full gate, deploy and read back every `docs/DELIVERY.md` row, then hand the preview to
the testers with `docs/TESTING-GUIDE.md`.
