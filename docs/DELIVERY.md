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

| Feature                     | Unit                                                                                            | Native journey                                                            | Preview readback                       |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| Email code sign-in, logout  | `AuthHttp`, `SessionAccount`, `login.story`, `session.story`, `signInReturn`, auth `Client`     | `IdentityBrowserAcceptance`; Origin/CSRF and session reads                | `preview.native` auth; walk sign-in    |
| Account deletion            | `AccountRead`, `account.story`, `account.scene`                                                 | `WardrobeAcceptance` (deletes accounts)                                   | walk                                   |
| Credits: daily 100, holds   | `Holds`, `Receipts`, domain `Wallet.story`, `GenerationSettle`, `StylistSweep`                  | reservations in native SQLite DOs; long video stops at limit              | Workers Logs: 0 pending holds          |
| Jobs and sweeps             | `Jobs`, `Sweeps`, `StylistSweep`, `GenerationSettle`, `Deletes`                                 | wallet, sessions and R2 recover after a Worker restart                    | `Styld.Sweep` lines idle               |
| Providers: deadlines, costs | `ProviderCall`, `CaptureProviders`, `LanguageModel`, `Pacing`                                   | fake providers in every journey                                           | `provider-live` per provider           |
| Photos to the review tray   | `Garments`, `SamPrompts`, `Matte`, `Chroma`, `Uploads`, `addPieces.story`, `review.story/scene` | `CaptureAcceptance`; `CaptureBrowserAcceptance` (picker)                  | one real photo per intent              |
| Hold-it-up camera           | `Stillness`, `heldCamera.story`                                                                 | `CaptureBrowserAcceptance` (camera, front then back)                      | walk on a phone                        |
| Video scans                 | `PartPlan`, `Sampler`, `upload`                                                                 | `CaptureAcceptance` (one card per garment); long video                    | a recorded scan                        |
| Scan anything, shop links   | `LinkImport`                                                                                    | `ScanAcceptance` (the tray after a scan); `SocialAcceptance`              | a shop link                            |
| Clean pictures and the turn | `CleanPicture`, `PieceCutout`, `Turn`, `TurnAnchors`, `TurnSheet`                               | `CleanPictureAcceptance`, `TurnAcceptance`                                | redraw and a turn on a real piece      |
| Wardrobe browsing           | `Wardrobe`, `wardrobe.story/scene`, `pieces.story`                                              | `WardrobeAcceptance` (attributes, private images)                         | every row decodes; filter walk         |
| A piece's page and back     | `piece.story/scene`, `pieceBack.story`                                                          | `WardrobeAcceptance` (back owner-only)                                    | walk                                   |
| Today: Spin and Wear this   | `today.scene`, `Outfits`, `OutfitService`                                                       | `GalleryBrowserAcceptance` (today's table); `GalleryAcceptance` worn days | walk                                   |
| Outfit engine               | `Outfits` (rules), `OutfitService`                                                              | `OutfitAcceptance` (Fast, Thinking, pace, daily cap)                      | Fast and Thinking timings              |
| Looks                       | `looks.story/scene`, `look.scene`                                                               | `GalleryAcceptance` (website looks)                                       | walk                                   |
| Boards and the collage      | `board.story`, `boardPage.story/scene`, `boards.scene`, `collage.scene`, protocol `Placement`   | `GalleryAcceptance`; `GalleryBrowserAcceptance` (collage)                 | walk on phone and desktop              |
| Stickers and mood boards    | `Sticker`, `Planner`, `make.story/scene`                                                        | `GenerationAcceptance`                                                    | a sticker and a mood board             |
| My Gallery                  | `photos.story/scene`, `gallery.story`, `saveToBoard.story`                                      | `PhotosAcceptance`                                                        | a worn photo (pending, owner)          |
| Styld, the stylist          | `Stylist`, `StylistSweep`, `stylist.story/scene`                                                | `StylistAcceptance`                                                       | a chat in en and sl                    |
| Profiles and public pages   | `profileEditor.story/scene`, `profileMore.scene`, `visit.story/scene`, `EdgeMeta`, `EdgeWorker` | `SocialAcceptance`; `SocialBrowserAcceptance` (signed out)                | a shared link's preview card           |
| Save, follow, block, report | `people.story`, `publicActions.scene`, `Checks`                                                 | `SocialAcceptance`                                                        | walk with two accounts                 |
| Explore and search          | `ask.story/scene`, `navigation.story`                                                           | `SocialAcceptance` (discovery)                                            | walk                                   |
| Content checks              | `Checks`, `ContentJudge`                                                                        | `SocialAcceptance` (check before public)                                  | Workers Logs judge span                |
| ChatGPT and Claude (MCP)    | `Mcp` (every tool), `assistantViews.story`, protocol `Api`                                      | `McpAcceptance` (OAuth, consent, revoke, both protocol eras)              | `preview.native` MCP; a host connected |
| v1 import                   | `Mapping`, `Report` (`tools/import-v1/`)                                                        | `ImportAcceptance` (existing and made account, twice)                     | reports reconciled (74, 313)           |
| Schema baseline             | `Schema`                                                                                        | D1 schema equals its snapshot                                             | every wardrobe row decodes             |
| en/sl and rendering         | `i18n`, `catalog`, `Rendering`, `masthead.scene`, `controls.scene`                              | locale persists in a browser; Slovenian `Intl` in workerd                 | walk in sl                             |
| Telemetry with consent      | `Telemetry`, `BrowserTelemetry`, `Observability`                                                | `BrowserAcceptance` (what the page sends, before and after consent)       | browser trace joined in Workers Logs   |
| Edge, assets, budgets       | `EdgeWorker`, `IsolateCache`, `public-fonts`                                                    | built document and assets through the edge                                | `bundle:check` on the deployed build   |

Not yet accepted at the preview level for release `54a6601`: the rows whose readback column names a walk, until C8's
walk on phone and desktop in en and sl is recorded in STATUS.

## Kept, not built

Template boards (One item, many outfits; Before you buy; Travel), board export, the try-on quality test and try-on
(M4–M6, M8–M9, frozen); billing; go-live (legal pages, the reviewer account, the ChatGPT directory, the cutover).
Each gets its rows here when it is built. `docs/ROADMAP.md` holds their decisions.

## Completion conditions

Every kept row accepted at its levels; no unresolved high or medium review finding; `heavy --wait bun run check` green
at the final commit; the preview deployed from that commit with `/api/health` reporting it; a clean owned worktree; no
production change without the owner's go.
