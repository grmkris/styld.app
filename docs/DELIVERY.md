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

| Feature                        | Unit                                                                                                                                                       | Native journey                                                                       | Preview readback                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Sign in with Google            | `GoogleEntry` (linking by verified address), `AuthHttp` (callback), `Login` Continue with Google, `SignInReturn` `noteNext`                                | `GoogleEntry.test` (unit); native and a live preview sign-in open                    | live sign-in on the preview                    |
| Email code sign-in, logout     | `AuthHttp`, `SessionAccount`, `login.story`, `session.story`, `signInReturn`, auth `Client`                                                                | `IdentityBrowserAcceptance`; Origin/CSRF and session reads                           | `preview.native` auth; walk sign-in            |
| Account deletion               | `AccountRead`, `account.story`, `account.scene`                                                                                                            | `WardrobeAcceptance` (deletes accounts)                                              | walk                                           |
| Premium week (Dodo payments)   | `Billing` (signature vector, product filter, credit once, take back once, checkout body), `Wallet.story` premium, `Holds`, `account.story/scene`           | `BillingAcceptance` (a stage without payments) written, not run                      | test-card purchase on the preview, open        |
| Credits: daily 100, holds      | `Holds`, `Receipts`, `PaidClaims`, `PaidAttempts`, `Settlements`, domain `Wallet.story`, `GenerationSettle`, `StylistSweep`                                | reservations in native SQLite DOs; concurrent redraw/turn; long video stops at limit | Workers Logs: 0 pending holds                  |
| Jobs and sweeps                | `Jobs`, `Sweeps`, `StylistSweep`, `GenerationSettle`, `Deletes`                                                                                            | wallet, sessions and R2 recover after a Worker restart                               | `Styld.Sweep` lines idle                       |
| Providers: deadlines, costs    | `ProviderCall`, `CaptureProviders`, `LanguageModel`, `Pacing`                                                                                              | fake providers in every journey                                                      | `provider-live` per provider                   |
| Photos to the review tray      | `Garments`, `SamPrompts`, `Matte`, `Chroma`, `Uploads`, `addPieces.story`, `review.story/scene`                                                            | `CaptureAcceptance`; `CaptureBrowserAcceptance` (picker)                             | one real photo per intent                      |
| Hold-it-up camera              | `Stillness`, `heldCamera.story`                                                                                                                            | `CaptureBrowserAcceptance` (camera, front then back)                                 | walk on a phone                                |
| Video scans                    | `PartPlan`, `Sampler`, `upload`                                                                                                                            | `CaptureAcceptance` (one card per garment); long video                               | a recorded scan                                |
| Scan anything, shop links      | `LinkImport`                                                                                                                                               | `ScanAcceptance` (the tray after a scan); `SocialAcceptance`                         | a shop link                                    |
| Clean pictures and the turn    | `CleanPicture`, `PieceCutout`, `BackPictureStore`, `PieceImages`, `Turn`, `TurnAnchors`, `TurnSheet`                                                       | `CleanPictureAcceptance` (incl. the drawn back), `TurnAcceptance`                    | redraw and a turn on a real piece              |
| Wardrobe browsing              | `Wardrobe`, `SignedMedia`, `wardrobe.story/scene`, `pieces.story`                                                                                          | `WardrobeAcceptance` (attributes, signed images and tamper rejection)                | every row decodes; filter walk                 |
| A piece's page and back        | `piece.story/scene` (angles first, the drawn back), `pieceBack.story`                                                                                      | `WardrobeAcceptance` (back owner-only, free)                                         | walk                                           |
| Delete several pieces          | `Deletes`, `wardrobeSelect.story/scene`, `Mcp`                                                                                                             | `WardrobeAcceptance` (batch delete); `McpAcceptance` (`pieces_delete`)               | walk on a phone (Eva)                          |
| Today: Spin and Wear this      | `today.scene`, `Outfits`, `OutfitService`                                                                                                                  | `GalleryBrowserAcceptance` (today's table); `GalleryAcceptance` worn days            | walk                                           |
| Outfit engine                  | `Outfits` (rules), `OutfitService`                                                                                                                         | `OutfitAcceptance` (Fast, Thinking, pace, daily cap)                                 | Fast and Thinking timings                      |
| Looks                          | `looks.story/scene`, `look.scene`                                                                                                                          | `GalleryAcceptance` (website looks)                                                  | walk                                           |
| Boards and the collage         | `board.story`, `boardPage.story/scene`, `boards.scene`, `collage.scene`, protocol `Placement`                                                              | `GalleryAcceptance`; `GalleryBrowserAcceptance` (collage)                            | walk on phone and desktop                      |
| Looks kept on a board (T-16)   | `board.story` (select mode), `collage.scene`                                                                                                               | `BoardOutfitsAcceptance` (keep); `GalleryBrowserAcceptance` (select mode)            | walk on phone                                  |
| One piece, many outfits (T-10) | `Outfits` (complete, distinct, shoes), protocol `OutfitLayout` (layouts, arrows), `boardOutfits.story`, `boardPage.scene`, `boards.scene`, `gallery.story` | `BoardOutfitsAcceptance`; `BoardOutfitsBrowserAcceptance`                            | readback with a seeded account; walk           |
| Stickers and mood boards       | `Sticker`, `Planner`, `make.story/scene`                                                                                                                   | `GenerationAcceptance`                                                               | a sticker and a mood board                     |
| My Gallery                     | `photos.story/scene`, `gallery.story`, `saveToBoard.story`                                                                                                 | `PhotosAcceptance`                                                                   | a worn photo (pending, owner)                  |
| Gallery: pick or add a piece   | `photos.story/scene` (whole wardrobe, search, by hand), `collage.scene` (shared sheet), `GalleryPerson` (seated)                                           | `PhotosAcceptance` (adding by hand, the offered guard)                               | walk on a phone (Eva)                          |
| Gallery: photos found again    | `PhotoRefind` (the merge)                                                                                                                                  | `PhotosAcceptance` (`verifyRefinding`)                                               | `tools/refind-photos.ts` run for Eva           |
| Styld, the stylist             | `Stylist`, `StylistSweep`, `stylist.story/scene`                                                                                                           | `StylistAcceptance`                                                                  | a chat in en and sl                            |
| Profiles and public pages      | `profileEditor.story/scene`, `profileMore.scene`, `visit.story/scene`, `EdgeMeta`, `EdgeWorker`                                                            | `SocialAcceptance`; `SocialBrowserAcceptance` (signed out)                           | a shared link's preview card                   |
| Save, follow, block, report    | `people.story`, `publicActions.scene`, `Checks`                                                                                                            | `SocialAcceptance`                                                                   | walk with two accounts                         |
| Search (Ask) and the landing   | `ask.story/scene`, `navigation.story`, `landing.story/scene`                                                                                               | `SocialAcceptance` (discovery)                                                       | walk                                           |
| What's new on Home             | `whatsNew.story/scene`, `Feed` (local D1)                                                                                                                  | `SocialAcceptance` (`verifyWhatsNew`); `GalleryBrowserAcceptance` (strip)            | two accounts; Eva on a phone                   |
| What to wear today (tombola)   | `tombola.story/scene`, `wearIt.story`                                                                                                                      | `GalleryBrowserAcceptance` (`verifyHome`, `verifyTombolaBoards`)                     | Eva on a phone                                 |
| Content checks                 | `Checks`, `ContentJudge`                                                                                                                                   | `SocialAcceptance` (check before public)                                             | Workers Logs judge span                        |
| ChatGPT and Claude (MCP)       | `Mcp` (every tool), `assistantViews.story`, protocol `Api`                                                                                                 | `McpAcceptance` (OAuth, consent, revoke, both protocol eras)                         | `preview.native` MCP; a host connected         |
| House boards: seed, Generated  | `HouseSeedTables`, `SeedPlans`, `Translated`, `PublicGenerated`, `tools/seed` (`Prompt`, `Ledger`, `Garments`, `Run`, `Plan`)                              | `SeedAcceptance` (operator and house only, once, sl, Generated)                      | fixture boards seeded, read back en/sl, pruned |
| Show me                        | `ShowMe`, `Feed` (bands), `showMe.story/scene`, `session.story`                                                                                            | `IdentityBrowserAcceptance` (lands on Home, the card)                                | a new account's What's new under each choice   |
| Try with my wardrobe           | `TryBoard` (swaps, labels en/sl, once, nothing written), `tryBoard.scene`                                                                                  | `SeedAcceptance` (try, again, signed out)                                            | a try on a seeded board with a test account    |
| v1 import                      | `Mapping`, `Report` (`tools/import-v1/`)                                                                                                                   | `ImportAcceptance` (existing and made account, twice)                                | reports reconciled (74, 313)                   |
| Schema baseline and migrations | `Schema`, `DurabilityMigration`                                                                                                                            | D1 schema equals its snapshot                                                        | migrations applied; every wardrobe row decodes |
| en/sl and rendering            | `i18n`, `catalog`, `Rendering`, `masthead.scene`, `controls.scene`                                                                                         | locale persists in a browser; Slovenian `Intl` in workerd                            | walk in sl                                     |
| Telemetry with consent         | `Telemetry`, `BrowserTelemetry`, `Observability`                                                                                                           | `BrowserAcceptance` (what the page sends, before and after consent)                  | browser trace joined in Workers Logs           |
| Edge, assets, budgets          | `EdgeWorker`, `IsolateCache`, `public-fonts`                                                                                                               | built document and assets through the edge                                           | `bundle:check` on the deployed build           |

Release `8ff72e7cb83ba6636526d95a830d126204a484a3` passed the full integration gate (753 unit tests, 29 native tests)
and deployed `preview.native` acceptance (3 tests, 42 assertions) on 3 November. Preview D1 records all four
migrations through `c8_durability`; the deployment build passed its bundle budgets. `docs/STATUS.md` records the
release, deployment ids and evidence boundaries.

Not yet accepted at the preview level for this release: the rows whose readback column names a walk, signed-in
journey, provider call, private-data reconciliation or Workers Logs check. C8's phone/desktop walks in en and sl,
Styld's live language behaviour and outfit timing still need to be recorded in STATUS. Automated smoke acceptance
does not close those rows.

## Kept, not built

Template boards beyond "One piece, many outfits" (Before you buy and the Wishlist board, Travel, the week, the outfit of
the day, a blank lookbook), board export, the try-on quality test and try-on (M5–M6, M8–M9, frozen); go-live (legal pages, the reviewer account, the ChatGPT directory, the cutover).
Each gets its rows here when it is built. `docs/ROADMAP.md` holds their decisions.

## Completion conditions

Every kept row accepted at its levels; no unresolved high or medium review finding; `heavy --wait bun run check` green
at the final commit; the preview deployed from that commit with `/api/health` reporting it; a clean owned worktree; no
production change without the owner's go.
