# Plan: house inspiration boards, Show me, Generated, Try with my wardrobe (4 Nov 2026)

Source brief (the owner's v3 seed prompt, with the catalogue and manifest it specifies) is kept privately in
`~/private/styld-research/house-boards-2026-11-04/` (`brief-v3.md`, `catalogue-v3.yaml`, `manifest-v1.yaml`); S4 commits the
catalogue and manifest into `tools/seed/`. Session `styldappv2-1c` builds S1–S4 and deploys the preview.

## Context

A new person who signs in to Styld sees nothing in What's new until the people they follow post. The owner wants
about 50 native boards there from day one: real `Piece` rows cut out from **Muse-generated garment images** (one per
garment, always labelled Generated), arranged by Styld's own board code on two house accounts, each board in English
with a Slovenian translation (review pending, Eva). After sign-in a person can say what to **Show me** first
(Women's / Men's / Everything), which reorders and never hides. The source brief is the pasted v3 seed prompt; this
plan is how it lands on the repo as it is at `1fe7c68a`/`c62c23e9`, with the owner's answers from this session.

## Owner answers (this session) and repo facts that change the brief

- **I deploy the preview** for this work (not 51), telling 51 and the Home track first (see Coordination).
- **House emails** are myinbox addresses made at S2: `styld-women.kris@myinbox.lol`, `styld-men.kris@myinbox.lol`
  (catch-all domain `myinbox.lol`, no expiry), configured as `STYLD_HOUSE_EMAILS`.
- **Handles** `@styld.women` + `@styld.men`; `@styld` stays reserved. **Everyone boards** split by catalogue `owner`.
- **Boards only, no looks.** Every outfit is a flat-lay cluster of pieces on the board's table, with no names or numbers
  on it. No shared looks, so What's new gets the 53 boards and nothing else from the house, and there are no look names
  to translate. Table text comes only from catalogue `label`/`credit` (which have sl); no auto-generated count labels.
- **Show me**: a card on Home above What's new plus a row on **Account** (there is no Settings page). **New sign-ups
  land on Home**: the no-`next` default of `returnAfterSignIn` changes from Account to Home.
- **Generated imports keep the manifest's type** (Clef's describe still fills seasons/occasions/pattern). Clef's type
  and `whole` score are recorded with provenance. A failed cut, `whole` < 0.5 or a different garment group holds the
  piece's boards back as _needs a look_. A same-group disagreement is only listed.

Where the repo contradicts the brief, and what I'll do:

1. **M4 already landed** (`fd3dbbc0`). Followed-first is per page; the cursor is an opaque string ≤ 100 (an ISO
   instant). Show me becomes **rank bands** carried in that cursor (`<band>.<iso>.<id>`), so the wire doesn't change.
2. **Imports now queue a Muse clean-picture redraw** (`5f73d754`, `capture/ImportedPicture.ts`), which costs about
   $1.73 for nothing on generated pieces. Generated imports skip it.
3. **Provenance is written by the import itself.** `ImportPiece` gains optional
   `generated: {manifestId, model, promptDigest}`, and the row goes into the same D1 batch as the piece. This replaces
   `PUT /operator/seed/provenance` and closes the window where the redraw or the backfill could see an unmarked piece.
   `piece_provenance` gains `described_type` and `described_whole` (Clef's second opinion).
4. **`createOutfitBoard` picks a random layout, draws from the whole wardrobe and ranks with Clef.** The seeder instead
   passes the catalogue's layout and outfits from the app's Fast rules (`outfits/Rules.ts` `proposed` + `validated`),
   run over that board's pieces only, seeded by `seedId:version`. That's deterministic and free, with no "Another
   until it fits" loop. If fewer outfits come back than needed, the board is refused and reported, and I fix the
   catalogue.
5. **`clusterSpots`/`clusterOf` are private** (`protocol/OutfitLayout.ts`). I'll export one grid layout for N = 3–8
   anchorless outfit clusters built on them; `onePiece` keeps `outfitsLaidOut`.
6. **There are no page chunks.** Every page ships in the first load, with about 119 B of headroom at `c62c23e9`. I'll
   raise the budget in `tools/bundle-check.ts` by the measured bytes with a dated note, as the Home track does.
7. **Muse painter**: `makeMusePainter.paint` is fixed at 1024×1024 and `body()` is private. I'll add an optional
   `size` to `paint` and import it from the tool, the way `provider-live.ts` imports `Meta.ts`.
8. **Meta from netcup answers over IPv6 only** (30 Oct note; the 4 Nov spike used `curl -6`). The tool injects a Meta
   fetch over IPv6, with the key passed through a mode-600 header file and never in argv. I'll check IPv4 first in case
   it works now.
9. **Endpoint paths**: `/operator/seed/boards/:seedId`, so it can't collide with `/operator/seed/profile` and
   `/operator/seed/pieces`. I'm adding `DELETE` for `--prune` and for fixture clean-up.
10. **Services need `CurrentAccount`.** The seeder provides `{accountId, via: 'assistant'}` (the precedent is
    `generation/Work.ts:213`), so no protocol change.
11. **`pieceCollage` counts**: six catalogue collages hold 8 pieces, not 9–14. I'll keep them, since the tidy grid takes
    any count.

## Data model (S1): one migration `…_house_seed_tags`, new tables only

Generated with `bunx drizzle-kit generate --name house_seed_tags` (rc.5, root `drizzle.config.ts`):

- `board_tags`, `board_translations` go in `packages/db/src/boards.ts`, written by `boards/`. The seeder composes
  `boards/Rows.ts` statements.
- `profile_translations` and `viewer_preferences` go in `social.ts`, written by `social/`.
- `piece_provenance` (+ `described_type`, `described_whole`) goes in `wardrobe.ts`, written by `wardrobe/`. Imports
  compose `PieceRows` statements, as they do for the piece itself.
- `seeded_boards` goes in a new `seed.ts` (added to `drizzle.config.ts`, `index.ts` and `seed/`).
- CHECKs come from the protocol literals via `oneOf` / `json_type`. Every table cascades from accounts, boards and
  pieces, as the brief specifies. Each table gets an owner entry in `tools/quality/patterns.ts`.
- Protocol: `BoardTags.ts` (`Audience`, `TagKind`, `BoardTag` checked per kind, aesthetic slug ≤ 40), `Translations.ts`
  (`ReviewState`, `BoardTranslation`, `ProfileTranslation`), `ShowMe`, `PieceOrigin`.
- Tests, with `localD1`:
  - the migration's SQL is only `CREATE TABLE`/`CREATE INDEX` (beside `MigrationSafety`);
  - every CHECK refuses a bad value;
  - deleting an account or board cascades to tags, translations, seed rows, preferences and provenance, and deleting
    a piece removes its provenance row;
  - the schema refusals the brief lists;
  - `Schema.test` snapshot equality.

## S2: operator seeding, generation, translated reads, Generated

Commits in this order; each one passes the cheap checks.

**S2a. Generation tooling and the real test batch** (`tools/seed/`, mirroring `tools/import-v1/`):

- `Catalogue.ts` and `Manifest.ts`: Effect Schemas over `Bun.YAML.parse`, plus the slot-resolution rule.
- `Prompt.ts`: the brief's template, pure, with a snapshot test.
- `MetaFetch.ts`: the IPv6 fetch.
- `Generate.ts`: Muse `paint`, 1024×1536 for long types.
- `Gate.ts`: Muse Spark JSON-schema verdict, or `--judge clef` via `CloudflareRest.runClef`. Pass rule as in the
  brief; at most 2 retries with the failure appended; `failed` is never substituted.
- `Ledger.ts`: pre-charges the worst case before each paid call, enforces `--max-usd` (default 5), counts a call with
  no answer as spent, and caches in `.out/`. A matching `prompt_digest` costs $0.
- `Plan.ts`: pure; orders by publish order, then derives operationIds.
- `Report.ts`: Markdown, plus `test-batch.html`.
- `Run.ts`: `--dry-run` (the default), `--test-batch`, `--full`, `--only`, `--regenerate`, `--photos`, `--prune`.
- The PR-2 fixture manifest holds the brief's 10 test-batch specs verbatim, plus a two-board fixture catalogue built
  from them.
- Register the tool in `knip.config.ts`, add `.gitignore` for `tools/seed/.out/`, and extract the R2 REST PUT from
  `import-v1/Import.ts` into a shared helper (jscpd).
- Tests use injected Meta clients that fail on any call during `--dry-run`. They cover the gate's fail cases, the
  2-retry cap, the Ledger cap stopping before the 6th call at $0.05, the cache costing $0, and `--test-batch` making
  exactly those 10 calls and no import.
- **Then run the real `--test-batch` once:**
  - first check that Spark exists on the key (one call), and say which judge ran;
  - share `test-batch.html` via `preview`;
  - report the first-try and final pass rates, the retries and the dollars;
  - **stop for your approval.** If first-try passes fall under 70%, propose prompt changes first.
  - Expected cost is about $0.15–0.40.

**S2b. Seed endpoint and generated imports:**

- `STYLD_HOUSE_EMAILS` goes into `Config.ts`, `alchemy.run.ts`, `.env.preview.local` and DEPLOYMENT.md, as a
  deployment fact.
- `packages/protocol/src/Seed.ts` (group `.middleware(OperatorAuth)`, one `.add` in `Api.ts`):
  - `PUT /operator/seed/profile`
  - `POST`, `GET` and `DELETE` on `/operator/seed/boards/:seedId`
  - `GET /operator/seed/pieces?email`
  - `PUT /operator/seed/pieces/:manifestId/picture` (the photo swap)
- New `packages/server/src/seed/` module (one entry in `Modules.ts`). It refuses any email not in
  `STYLD_HOUSE_EMAILS`, resolves `seed:<manifestId>` through `imported_pieces`, and refuses pieces that haven't been
  imported or that need a look.
- **Profile step:** runs as the account through `Profiles.updateProfile` and `publishProfile`, writes the
  `profile_translations` row before publishing (so the first check judges it), then `Curation.markHouse` (no manual
  `curation_house`). It skips when nothing changed.
- **Board step**, as the account through the app's services:
  - `onePiece`: a seed entry in `boards/Template.ts` that reuses `outfitBoardOf` with explicit layout and outfits.
  - `outfits` and `challenge`: `Boards.createBoard`, `addPins`, then `Tables.setTable` with the new cluster grid plus
    the catalogue labels.
  - `look`: `setTable` with `flatLay`.
  - `pack` and `pieceCollage`: pieces sorted by slot in wearing order, laid out with `tidied`, plus the labels.
  - Then the tags, the sl translation (labels keyed by the item ids `setTable` returned), and `search_text` with the
    sl name.
  - **Every pin is placed before `setBoardVisibility('public')`**, so a new board produces no "pinned on board" items.
- **Idempotency** is by `seeded_boards`:
  - same digest: no-op;
  - new digest: update in place (rename, re-lay, replace pins, tags and translation). The board stays public, so
    `publishedAt` is never bumped;
  - operationIds are `seed-` + sha256(`seedId:step:version`)[0:40].
  - Known edge: pieces added to an already-public board during an update do show as "pinned on board" in What's new.
- **Imports:**
  - `ImportPiece.generated` writes `piece_provenance`;
  - `ImportedPicture` and `BackfillStore.undrawnPieces` skip generated pieces (`NOT EXISTS`);
  - `wardrobe/Work.ts` `importedDetails` keeps the type for generated pieces and records Clef's type and `whole`.
- **Photo swap:** replaces the original on the **same piece id**, re-runs the cut and describe, sets `origin = 'photo'`
  (model and digest null), and marks the piece's check changed.

**S2c. Translated reads:**

- One `readerLocale` reads the `styld_locale` cookie, then `Accept-Language`, then `en`. MCP uses `Accept-Language`
  only. It is used by `PublicHttp` (meta and every public read), the feed, explore/search and `mcp/Route`.
- `PublicPages` methods take the locale. A new `social/Translated.ts` applies fresh translations in `summaries`,
  `pages.board`, `pages.profile` and the label mapping. "Fresh" means `source_digest` equals the digest of the current
  name and labels; a stale translation falls back to the original.
- `safety/Checks.ts`: board and profile shown texts add the fresh sl texts, so `shownDigest` changes with them.

**S2d. Generated on public reads:**

- `generated: boolean` on `PublicPiece`, `PublicBoard`, `PublicBoardSummary` and `PublicLook`. It is computed once in
  `Public.ts` from one chunked provenance read in `shownPieces`; a board is generated when any seen piece is, through
  pins, items or looks.
- Web: reuse `generatedMark`, always visible, on:
  - board tiles in `PublicTiles`;
  - the public board page;
  - look tiles;
  - the public piece view.
    One new key, `board.generatedHint` (en/sl as in the brief), for the accessible name and title. Link-preview
    descriptions get the hint.
- ROADMAP note dated 4 Nov, linked from the _Not porting_ line.

**S2 tests:**

- Operator endpoint:
  - NotFound without the token;
  - a non-house email refused;
  - a missing piece refused;
  - two runs leave `seeded_boards`, pins and boards unchanged;
  - editing one entry changes only that board and keeps its id;
  - no pin's `created_at` is after `published_at` on create.
- Translations:
  - an sl reader gets the translated name, labels and bio; an en reader gets the originals;
  - after a rename, the sl reader gets the original;
  - a changed translation changes the check digest;
  - a failed check keeps the board private.
- Imports and Generated:
  - provenance is written and the redraw is skipped;
  - the backfill never lists a generated piece;
  - Generated is true on the piece and on its board, and false on a board with no generated piece;
  - the photo swap keeps ids, flips `origin`, and `generated` becomes false;
  - the label renders in en and sl (scene).
- Native: `SeedAcceptance` (import with provenance, then profile, board and public read in en/sl), written now and
  run in the gate after the deploy.

**S2 acceptance:**

- Deploy to the preview.
- Seed the fixture's two boards onto the house accounts: both pass their checks and show Generated, and a re-run
  reports `0 generated, 0 imported, 0 created, 0 changed`, $0.
- The report prints the `curation_feature` calls.
- Then `--prune` the fixture boards.

## S3: Show me, feed ranking, Try with my wardrobe, sign-up lands on Home

- **Ranking, `social/ShowMe.ts`:** `showMeRank` is pure, with a full truth table.
- **Feed (`Feed.ts`):**
  - `band = followed ? 0 : showMeRank(choice, audience)`; pins and untagged boards rank 1.
  - Each band is read with indexable predicates: an `EXISTS` on `board_tags`, and a `follows` subquery (the D1
    100-parameter limit rules out passing 200 followed ids).
  - A page fills from the cursor's band onward, keeps the per-page followed-first ordering, and interleaves
    (`maxRun` 2) **within** each band.
  - With no choice, or `all`, everything is band 0, exactly M4 today.
- **Explore:** `houseBoards` and signed-in `explore_get` order by rank in SQL before the 24-row limit.
- **Preferences:** `packages/protocol/src/Preferences.ts` under `SessionAccount`: `GET /me/preferences` and
  `PUT /me/preferences/show-me`. Server code lives in `social/`.
- **Web:**
  - a `page/ShowMe.ts` Submodel folded into Today (one slot above the What's new strip). It reads only when signed in,
    hides once answered or after "Not now", and re-reads What's new after a choice;
  - an Account section for the same choice;
  - catalog keys from the brief in en and sl;
  - `returnAfterSignIn` defaults to Home.
- **Try with my wardrobe:**
  - `POST /boards/:boardId/try {operationId}` in its own protocol file, answering `{board, fromWardrobe, of}`.
  - Server `boards/Try.ts`: reads the board through `PublicPages` (visibility) and requires `generated`. It matches
    each generated piece to one of the caller's own ready pieces from `outfits/Wearables.ts` `wearablesOf` (same type,
    most shared colours, then first colour, then most recently worn or added), using each at most once. There is no
    colour-overlap helper today; `capture/MatchStore` only ranks one colour, so this one is new and small.
  - It writes a **private** board through `createBoard` and `setTable`, with the same positions. A miss becomes the
    label "No {colour} {type} yet" (sl uses catalog type and colour names; Eva reviews). It never pins a house piece
    and never writes to the caller's wardrobe.
  - Web: the button on generated public boards; signed out it opens sign-in with `next`; then the new board with
    "5 of 7 from your wardrobe".
- **Tests:**
  - 30 boards (10/10/10): Women's puts every women's board before any men's, Men's the reverse, and Everything keeps
    the publish order;
  - all 30 can be reached by paging, the cursor is stable, and a followed person stays first;
  - the card shows, hides and changes from Account (story and scene); signed out there is no card and no request;
  - the brief's Try case: 2 of 3, a "No brown loafers yet" label, the house board unchanged, nothing written to the
    wardrobe;
  - no button on a board with no generated piece;
  - the Home plan's M4 tests still pass.
- **Acceptance:**
  - a new myinbox account lands on Home and sees a mixed What's new; choosing Men's moves men's boards up without
    removing any;
  - the initial bundle bytes are stated, and the budget is raised by the measured amount.

## S4: content and the full run

- `tools/seed/catalogue.yaml` (the brief's §4 in the real schema, no looks) and `manifest.yaml` (§5).
- A runbook section in DEPLOYMENT.md: test batch → `--full` (generate, gate, import with provenance, profiles, boards)
  → curation calls, plus the photo swap.
- Tests:
  - the brief's catalogue and manifest rules, including the computed counts: 166 specs, 173 pieces, women 106,
    men 67, 7 shared. If those numbers don't come out, I report them;
  - every slot resolves and every spec is used;
  - sl copy has no _vi_ forms and no "(a)".
- `--dry-run` prints the manifest, costs, publish order and the three first-12 orderings. Featured picks are 6 per
  audience, marked `featured: true` in the catalogue and published last; I pick them and you can change them.
- **`--full` only after you approve the test batch.** It stays under the $5 cap and reports spend by item (Muse,
  judge, cut-outs), failed specs and the boards they held back.
- Readback: ≥ 50 boards, each Generated, every public one `passed` or listed with its reason. A brand-new account sees
  a full What's new and can save a board to `/saved`. A second run creates nothing.

## Coordination and deploy

- **eva-home-page-plan** (Home track, now editing `Today.ts`, `TodayView.ts`, Tombola and the catalogs): I message it
  before touching `Feed.ts`, `Today`/`TodayView` and the catalogs. I stage only my hunks (the `hash-object` route) and
  regenerate i18n from HEAD plus my keys.
- **styldappv2-51**: before each deploy I check that main is deployable (other tracks' undeployed migrations, e.g.
  the P4 rebuild state, and the preview's `/api/health` release) and that nobody else is deploying. Deploys run per
  DEPLOYMENT.md on the styld account. Then the readback, then `heavy --wait bun run check` with native in the
  background, fixing forward.
- Commits go on main with explicit paths, one per coherent green change. No stash or reset, and I never touch others'
  files.

## Verification

- **Per commit:** `bun run format`; `heavy --wait bun run typecheck`; `heavy --wait bun run lint`; the affected
  unit, story and scene tests (`heavy --wait`); `translations:check`; `unused:check`; the build with the bundle
  budget.
- **After each deploy:**
  - `STYLD_PREVIEW_URL=… heavy --wait bun test tools/preview.native.test.ts` (release = HEAD);
  - the seed run's report;
  - API readbacks in en and sl (cookie), checking the Generated flag, the order under each Show me, and Try with my
    wardrobe on a myinbox test account (sign-in codes via `verification_wait`);
  - the full gate with native in the background.
- STATUS, DELIVERY (new rows with evidence), ARCHITECTURE (the seed module and the house-account exception to "the
  real photo is the source") and TESTING-GUIDE are updated with each milestone.

## Still open (not blocking)

- Eva's call on the sl chip ("Ustvarjeno" or "Ustvarjeno z UI"); the existing key ships until then.
- Which specs to photograph first (§6.8): ask after the full run.
