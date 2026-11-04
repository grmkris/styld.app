# Delivery

Styld v2 ships the v1 behaviour worth keeping on Effect, Foldkit and Cloudflare, on an isolated workers.dev preview,
with acceptance at the right evidence level for every kept feature. Scope and order are the owner's
(`docs/ROADMAP.md`); what is live and open is `docs/STATUS.md`. The plan and matrix this replaced are in
`docs/archive/DELIVERY-2026-11-02.md`.

**v1 baseline:** `/home/kristjan/code/stylelab` at `dddf9d44b656701282debd2ff88b343851145126`, inventoried in
`docs/migration/v1-inventory.json`, `docs/migration/v1-features.md` and `docs/migration/v1-usage-2026-10-29.md`.

## Evidence levels

- **Unit:** Vitest, in memory or on SQLite with every migration (`packages/server/test/LocalD1.ts`); Foldkit Story
  and Scene tests in `apps/web/test/`.
- **Native:** `packages/server/test/Runtime.native.test.ts` runs the built website and the API Worker in workerd
  through the real edge, with fake providers (`test/NativeWorker.ts`, `test/fakes/`); browser journeys use Chromium.
  Below, a native journey is named by its acceptance file.
- **Preview:** `tools/preview.native.test.ts` against the deployed release (health and release, auth contracts,
  hydration, MCP discovery), plus a recorded browser walk on phone and desktop in en and sl.
- **Live provider:** `tools/provider-live.ts` (Meta's SAM video path) run by hand.

A source file, a green build or a stub answer does not prove a feature. A feature is accepted when every level its row
names passes at the release under test and the preview readback is recorded in STATUS.

## Feature → acceptance

| Feature                        | Unit                                                                                                                                             | Native journey                                                                       | Preview readback                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Email code sign-in, logout     | `AuthHttp`, `SessionAccount`, `login.story`, `session.story`, `signInReturn`, auth `Client`                                                      | `IdentityBrowserAcceptance`; Origin/CSRF and session reads                           | `preview.native` auth; walk sign-in            |
| Account deletion               | `AccountRead`, `account.story`, `account.scene`                                                                                                  | `WardrobeAcceptance` (deletes accounts)                                              | walk                                           |
| Credits: daily 100, holds      | `Holds`, `Receipts`, `PaidClaims`, `PaidAttempts`, `Settlements`, domain `Wallet.story`, `GenerationSettle`, `StylistSweep`                      | reservations in native SQLite DOs; concurrent redraw/turn; long video stops at limit | Workers Logs: 0 pending holds                  |
| Jobs and sweeps                | `Jobs`, `Sweeps`, `StylistSweep`, `GenerationSettle`, `Deletes`                                                                                  | wallet, sessions and R2 recover after a Worker restart                               | `Styld.Sweep` lines idle                       |
| Providers: deadlines, costs    | `ProviderCall`, `CaptureProviders`, `LanguageModel`, `Pacing`                                                                                    | fake providers in every journey                                                      | `provider-live` per provider                   |
| Photos to the review tray      | `Garments`, `SamPrompts`, `Matte`, `Chroma`, `Uploads`, `addPieces.story`, `review.story/scene`                                                  | `CaptureAcceptance`; `CaptureBrowserAcceptance` (picker)                             | one real photo per intent                      |
| Hold-it-up camera              | `Stillness`, `heldCamera.story`                                                                                                                  | `CaptureBrowserAcceptance` (camera, front then back)                                 | walk on a phone                                |
| Video scans                    | `PartPlan`, `Sampler`, `upload`                                                                                                                  | `CaptureAcceptance` (one card per garment); long video                               | a recorded scan                                |
| Scan anything, shop links      | `LinkImport`                                                                                                                                     | `ScanAcceptance` (the tray after a scan); `SocialAcceptance`                         | a shop link                                    |
| Clean pictures and the turn    | `CleanPicture`, `PieceCutout`, `Turn`, `TurnAnchors`, `TurnSheet`                                                                                | `CleanPictureAcceptance`, `TurnAcceptance`                                           | redraw and a turn on a real piece              |
| Wardrobe browsing              | `Wardrobe`, `SignedMedia`, `wardrobe.story/scene`, `pieces.story`                                                                                | `WardrobeAcceptance` (attributes, signed images and tamper rejection)                | every row decodes; filter walk                 |
| A piece's page and back        | `piece.story/scene`, `pieceBack.story`                                                                                                           | `WardrobeAcceptance` (back owner-only)                                               | walk                                           |
| Today: Spin and Wear this      | `today.scene`, `Outfits`, `OutfitService`                                                                                                        | `GalleryBrowserAcceptance` (today's table); `GalleryAcceptance` worn days            | walk                                           |
| Outfit engine                  | `Outfits` (rules), `OutfitService`                                                                                                               | `OutfitAcceptance` (Fast, Thinking, pace, daily cap)                                 | Fast and Thinking timings                      |
| Looks                          | `looks.story/scene`, `look.scene`                                                                                                                | `GalleryAcceptance` (website looks)                                                  | walk                                           |
| Boards and the collage         | `board.story`, `boardPage.story/scene`, `boards.scene`, `collage.scene`, protocol `Placement`                                                    | `GalleryAcceptance`; `GalleryBrowserAcceptance` (collage)                            | walk on phone and desktop                      |
| Looks kept on a board (T-16)   | `board.story` (select mode), `collage.scene`                                                                                                     | `BoardOutfitsAcceptance` (keep); `GalleryBrowserAcceptance` (select mode)            | walk on phone                                  |
| One piece, six outfits (T-10)  | `Outfits` (complete, distinct), protocol `Placement` (clusters, paper), `boardOutfits.story`, `boardPage.scene`, `boards.scene`, `gallery.story` | `BoardOutfitsAcceptance`; `BoardOutfitsBrowserAcceptance`                            | readback with a seeded account; walk           |
| Stickers and mood boards       | `Sticker`, `Planner`, `make.story/scene`                                                                                                         | `GenerationAcceptance`                                                               | a sticker and a mood board                     |
| My Gallery                     | `photos.story/scene`, `gallery.story`, `saveToBoard.story`                                                                                       | `PhotosAcceptance`                                                                   | a worn photo (pending, owner)                  |
| Styld, the stylist             | `Stylist`, `StylistSweep`, `stylist.story/scene`                                                                                                 | `StylistAcceptance`                                                                  | a chat in en and sl                            |
| Profiles and public pages      | `profileEditor.story/scene`, `profileMore.scene`, `visit.story/scene`, `EdgeMeta`, `EdgeWorker`                                                  | `SocialAcceptance`; `SocialBrowserAcceptance` (signed out)                           | a shared link's preview card                   |
| Save, follow, block, report    | `people.story`, `publicActions.scene`, `Checks`                                                                                                  | `SocialAcceptance`                                                                   | walk with two accounts                         |
| Explore and search             | `ask.story/scene`, `navigation.story`                                                                                                            | `SocialAcceptance` (discovery)                                                       | walk                                           |
| Content checks                 | `Checks`, `ContentJudge`                                                                                                                         | `SocialAcceptance` (check before public)                                             | Workers Logs judge span                        |
| ChatGPT and Claude (MCP)       | `Mcp` (every tool), `assistantViews.story`, protocol `Api`                                                                                       | `McpAcceptance` (OAuth, consent, revoke, both protocol eras)                         | `preview.native` MCP; a host connected         |
| v1 import                      | `Mapping`, `Report` (`tools/import-v1/`)                                                                                                         | `ImportAcceptance` (existing and made account, twice)                                | reports reconciled (74, 313)                   |
| Schema baseline and migrations | `Schema`, `DurabilityMigration`                                                                                                                  | D1 schema equals its snapshot                                                        | migrations applied; every wardrobe row decodes |
| en/sl and rendering            | `i18n`, `catalog`, `Rendering`, `masthead.scene`, `controls.scene`                                                                               | locale persists in a browser; Slovenian `Intl` in workerd                            | walk in sl                                     |
| Telemetry with consent         | `Telemetry`, `BrowserTelemetry`, `Observability`                                                                                                 | `BrowserAcceptance` (what the page sends, before and after consent)                  | browser trace joined in Workers Logs           |
| Edge, assets, budgets          | `EdgeWorker`, `IsolateCache`, `public-fonts`                                                                                                     | built document and assets through the edge                                           | `bundle:check` on the deployed build           |

Release `8ff72e7cb83ba6636526d95a830d126204a484a3` passed the full integration gate (753 unit tests, 29 native tests)
and deployed `preview.native` acceptance (3 tests, 42 assertions) on 3 November. Preview D1 records all four
migrations through `c8_durability`; the deployment build passed its bundle budgets. `docs/STATUS.md` records the
release, deployment ids and evidence boundaries.

Not yet accepted at the preview level for this release: the rows whose readback column names a walk, signed-in
journey, provider call, private-data reconciliation or Workers Logs check. C8's phone/desktop walks in en and sl,
Styld's live language behaviour and outfit timing still need to be recorded in STATUS. Automated smoke acceptance
does not close those rows.

## Kept, not built

Template boards beyond "One piece, six outfits" (Before you buy and the Wishlist board, Travel, the week, the outfit of
the day, a blank lookbook), board export, the try-on quality test and try-on (M5–M6, M8–M9, frozen); billing; go-live (legal pages, the reviewer account, the ChatGPT directory, the cutover).
Each gets its rows here when it is built. `docs/ROADMAP.md` holds their decisions.

## Completion conditions

Every kept row accepted at its levels; no unresolved high or medium review finding; `heavy --wait bun run check` green
at the final commit; the preview deployed from that commit with `/api/health` reporting it; a clean owned worktree; no
production change without the owner's go.

## Review and planning document

Eva's 2 November review has a separate [public tracker](https://styld-review-07c26b483ccc.pages.dev), maintained
in `docs/research/eva-review-tracker/`. It preserves 51 findings, 21 ticket drafts and 35 screenshots, with code
observations and shared progress. Acceptance of this document covers source completeness, navigation, mobile
reading, screenshot delivery and repeatable publishing. Its live browser checks passed on 3 November; see
`VALIDATION.md` in that directory. Its publication alone does not establish application acceptance. The owner subsequently authorized batch 01;
its application evidence is tracked separately below.

## Eva easy-fix batch 01

| Change                                                      | Focused behavior                                                                                                     | Native / preview boundary                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| T-13: direct Ask, separate Wardrobe search                  | `masthead.scene`, existing `ask.scene`                                                                               | `GalleryBrowserAcceptance`: navigation opens chat and resumes it; passed                                                |
| T-15 (partial): piece edit/detail clarity                   | `piece.scene` and `piece.story`: board picker, edit controls, delete confirmation, draft preservation and save guard | Matching before/after screens and preview readback passed; rotation remains open                                        |
| T-05 (partial): camera source hierarchy and finish controls | Existing camera stories: closing invalidates pending recognition                                                     | `CaptureBrowserAcceptance`: count finishes and retains paired photos; passed; countdown/recognition changes remain open |

Every completed ticket must carry before/after screenshots in the shared tracker. Native fixtures, Chromium
viewports, deployed smoke acceptance, physical devices and paid-provider behavior are distinct evidence levels.

Batch `c05071e` passed the full gate on 3 November (755 unit tests, 29 native tests / 1,276 assertions), deployed
to the isolated preview, and passed exact-release smoke acceptance (3 tests / 42 assertions). Nine before/after
pairs are attached to T-13, T-15 and T-05. T-13 is verified; T-15/T-05 remain partial. See the tracker’s `BATCH-01.md`.

## Eva board batch 02

T-04, T-09 and T-11 add stable Front/Back layering, direct owned-board editing and a category/type piece sheet.
`board.story`, `boardPage.story/scene`, `collage.scene`, `make.scene` and protocol `Placement` cover the local
behavior. Native Gallery acceptance covers atomic pin/placement retries, preserved layouts, stale-save conflicts,
foreign ownership and the direct browser editor; Photos acceptance checks the placed picture stays private.
Six matching before/after pairs and the review boundaries are in the tracker's `BATCH-02.md`. The full gate passed
(759 unit tests; 29 native tests / 1,284 assertions), including the signed-in board journey. Application release
`021dabe` deployed to the isolated preview and passed exact-release smoke acceptance (3 tests / 42 assertions).
T-04, T-09 and T-11 are verified; physical-device and live-provider acceptance remain separate.

## Eva camera batch 03

The central cancellable 3–2–1 count and fresh final frame are covered by `heldCamera.scene` and `heldCamera.story`;
`Stillness` covers dark/uniform-frame rejection. `GuidedCameraBrowserAcceptance` verifies no checks on a covered
frame, cancellation mid-count, motion between sides and one wardrobe piece with its back despite a side-confused
recognition response. Full gate: 763 unit and 29 native tests passed; four matching screenshot pairs passed visual
review at 390×844 and 1440×844. Release `15ddaca` is deployed; exact-release preview smoke passed 3 tests / 42 assertions. F-49 is verified.
T-01/T-05 remain partial: recognition,
foreground extraction, review-card Front/Back preview and real-phone/provider acceptance remain open.

## Eva media batch 04

T-21’s local implementation covers remaining private board, Gallery, detection and turn media plus embedded MCP
view thumbnails. `SignedMedia`/`SignedFile` unit coverage and `MediaLoadAcceptance`, `GalleryAcceptance`,
`PhotosAcceptance`, `CaptureAcceptance`, `TurnAcceptance` and MCP native acceptance passed in the full gate
(777 unit tests; 30 native tests / 1,453 assertions). Six matching synthetic before/after screenshot pairs passed
17 capture assertions and visual review. Release `ac535e1` is deployed; exact-release smoke passed three tests /
42 assertions. Signed-in preview media readback, authenticated loading/Workers Logs and
expiry-refresh remain open; this does not verify F-43. See the tracker’s `BATCH-04.md`.

## Eva browse batch, Claude batch 02

T-08 (Lab tab, `e13f05f`), T-07 (wardrobe drill-down, `1aa780d`), T-17 (Gallery photo cut-out, swipe, heart and board
source, `61c7b49`) and T-12 (new types, four seasons and Rainproof, `6f8be7f`; categories, `b210567`) are on `main` with
unit, story and scene acceptance and updated native browser journeys (Navigation, Gallery, Layout, Photos). The T-12
migration's row preservation is proven on local D1 and in `MigrationSafety.test.ts`. Preview readback, the native suite
on the batch and phone acceptance are open; so are the editor's rename/delete buttons and the review tray's category
suggestion (see `STATUS.md`).

## Eva navigation batch 05

T-06 adds URL-backed Wardrobe filters and selected-piece anchors, safe Gallery-to-review return paths, and clean
board history for the legacy collage route and settings dialog. The focused native journey covers 390×844 and
1440×844 through local workerd/Chromium (1 test / 17 assertions), with four matching screenshot pairs. Preview
smoke, an authenticated preview walk and physical Android Back remain separate acceptance levels. See
`docs/research/eva-review-tracker/BATCH-05.md`.

The navigation release `50eb1bf902dcff32f92eb507e01570b20b7a0a7f` passed exact-release preview smoke (3 tests /
42 assertions). Cloudflare readback confirmed the API binding and 100% deployments for edge, SSR and API; no
database, queue or Durable Object changes were planned. Signed-in preview navigation and physical Android Back
remain open.
