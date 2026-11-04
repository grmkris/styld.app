# Plan: Eva's Gallery matching and delete from the wardrobe grid (4 November, afternoon)

## Context

Eva's messages at 16:22 and 16:25, with two Gallery screenshots taken at 11:51:

- "Here at the gallery it can't recognise the outfit." One photo found nothing at all. On another, Styld found her fleece but said "Not in your wardrobe yet".
- "When I search it only offers this, not by category, so searching is hopeless." The cardigan is filed under outerwear, "so it won't let me add it at all".
- "We need an 'add from my wardrobe' button, so you can add pieces by hand."
- "A delete button on the front, instead of opening each piece, then Edit, scrolling down and Delete."

None of this is in progress. The 4 November plan (pictures P1–P3, tops P4, boards B1–B3) and the tracker (T-01…T-21) don't cover it. Today's T-03 deploy (`4b356234`, live since about 11:55) changed Gallery detection, but Eva's photos were analysed before it.

Root causes found:

1. **The picker only offers the same slot.** `candidates` in `apps/web/src/page/PhotoView.ts:36` keeps only ready pieces whose `slotOf` equals the detected garment's. The fleece was read as a top and her piece is outerwear, so it can never be offered. The grid has no categories or search, and `pieceLabel` makes every tile say "Top".
2. **Nothing can be added that wasn't detected.** Every `photo_garments` row needs a cutout from the photo (`cutout_key NOT NULL`, `packages/db/src/photos.ts:56`).
3. **Detection drops a seated person's clothes.** In `capture/Garments.ts:234-237`, once SAM finds any person, only masks at least 50% on that person count. A seated or cropped person can lose everything, and the photo ends `ready` with an empty list and no empty state (`PhotoView.ts:323-331`). It falls back to all garments only when no person is found at all.
4. **Old photos keep their old findings.** Her existing photos were found by the pre-T-03 detector, and there is no way to find them again.
5. **Deleting is slow.** It is only possible from the piece page, through Edit. There is no batch delete anywhere (protocol, server, MCP or web).

## Owner decisions (4 November)

- Delete from the grid: a **Select mode**. Tick cards, then "Delete N pieces", with one confirmation.
- **No undo.** The delete is permanent after the confirmation, as on the piece page.
- A piece **added by hand** to a photo behaves exactly like a confirmed match: it shows under "In your photos" on the piece page and goes into "Wear it again". (A confirmation records no worn day today, and neither will this.)
- Eva's existing photos: an **operator re-run** with the new detector, paid by Styld. Rows she confirmed are kept.

## Assumptions (no need to ask)

- The new sheet opens on the detected garment's group (Clothing, Shoes or Accessories), with its type chip preselected when one is known. Every piece can be reached with one tap on "All".
- Tiles show the piece's picture plus its name, or else "kind, colour", as `pieceDescription` already builds. That replaces the bare "Top".
- Search is client-side over the loaded wardrobe, through `AskSearch.matching`. `listPieces` has no cap, so all 370 of her pieces are there.
- Choosing a piece for a found garment keeps the garment's detected type: the row shows the piece, whatever its type.
- Select mode is on the label-free grid of a type (T-07's last level), where she sees her pieces. The group and type cards stay links.

## Tracks

There are two tracks of my own, run side by side. Each has a detached worktree under `~/code/styldappv2.wt/`, lands on main by rebase, and is never deployed by me (`styldappv2-51` deploys). I run the Gallery track myself, and a background agent with a self-contained brief runs the Delete track. One commit per green piece. Each commit gets cheap checks (format, typecheck, lint on touched files, the affected unit, story and scene tests). The full `heavy --wait bun run check` and native runs happen once per track at the end.

### Track G: Gallery, "Add from my wardrobe"

**G1. A wardrobe piece sheet shared by the board and the Gallery (web only).**

- Move the board's "Add your piece" sheet into a shared Submodel, `apps/web/src/page/PiecePicker.ts`, `PiecePickerView.ts` and `.styles.ts`. Today it lives in `Board/PiecePickerView.ts`, with its state in `Board/Model.ts:183-185` and `Page.ts:55-60,308-316`.
  - The Model holds the `Dialog.Model` (with a per-page dialog id, like `SaveToBoard.init`), the group and type filters, and a query.
  - The view inputs are `pieces: PiecesData`, `locale`, the ids already used (for the board's "on table" tick) and a title.
  - Choosing a piece sends `OutMessage.ChosePiece { pieceId }`.
  - The pinned-pictures section stays a board-only extra.
  - Follow the `SaveToBoard` and `BoardStart` Submodel pattern (`SaveToBoard.ts:46-192`, `Boards.ts:130-145`).
- Add a search field, using `matching` from `page/AskSearch.ts:27` with `[locale]`. It filters within the chosen group and type, or across everything under "All".
- Add tile captions from `pieceDescription` (`page/WardrobeWords.ts:25`).
- **Board**: switch to the shared module, with no change in behaviour. The board's scene and story tests (`collage.scene.test.ts:117-173`, `board.story.test.ts:188`) and `BoardStartView`'s imports of `filterButton`/`groupFilters` must keep passing.
- **Photo**:
  - Replace `choosing`, `candidates` and the inline `picker` (`Photo.ts:46,81-83,319-322`, `PhotoView.ts:36-71`) with the sheet. "Not this one", "Change" and "Choose from your wardrobe" open it for that garment, and `ChosePiece` → `ClickedMatch` → the existing `MatchGarment` Command.
  - "None of my pieces" stays as a button in the sheet for a found garment.
  - The page passes `model.data.pieces` (`PiecesData`), not `piecesOf`, so the sheet can show that it is loading.
- **Server guard**: `matchGarment` refuses a garment in `offered` (an `OperationConflict`). Today it overwrites the row and orphans the tray link (`photos/Store.ts:130`).
- **Tests**:
  - Rewrite `photos.scene.test.ts:98-111` so the cardigan case is covered: a garment read as a top finds an outerwear piece under "All", and search finds it by colour or brand.
  - Add a Submodel story test for the picker (filter, search, choose → OutMessage), modelled on `saveToBoard.story.test.ts`.
  - Adjust `photos.story.test.ts`.
- **Copy** (en/sl through x18n): `photo.addFromWardrobe` "Add from my wardrobe", `piecePicker.search`, `piecePicker.all`, `piecePicker.noneFound`.
- **Bundle budget**: measure the change and log a raise if needed.
- This milestone alone fixes the cardigan.

**G2. Add a piece by hand (server, migration, web).**

- **Schema**: `photo_garments.cutout_key` becomes nullable. A row without a cutout was added by hand.
  - That needs a rebuild migration using the keep-aside pattern of `20261103203624_types_seasons_t12`: `__keep_captures` for `captures.garment_id`, and only the rows the drop deleted put back, as `0eedb270` does. `MigrationSafety.test.ts` gets a row-preservation case.
  - **P4 (tops by sleeve) also rebuilds `photo_garments`.** Before writing the migration, ask `styldappv2-51` which one lands first. The second one regenerates on top, so there is never two hand-written rebuilds racing in `snapshot.json`.
- **Protocol**: `POST /photos/:photoId/pieces` with payload `{ operationId, pieceId }` (`AddPhotoPiece`), returning `Photo`, with errors NotFound, OperationConflict and Unavailable.
  - The server checks that the photo is the account's own and `ready` (`finishFinding` rewrites the rows of a photo still being found), and that the piece is the account's and ready.
  - It inserts `{ cutoutKey: null, type: piece.type, colours: [], pieceId, state: 'confirmed', position: max+1 }` behind a receipt (`changedOnce`).
  - Adding a piece already confirmed on the photo answers with the photo unchanged.
- **Readers** of a row without a cutout:
  - `toPhoto` (`Photos.ts:67-81`) gives it no `image`, and the protocol adds `addedByHand: boolean` (or the web reads that `image` is missing; decided when reading the protocol).
  - A hand-added row whose piece was later deleted (`SET NULL`) is left out of `toPhoto`, not shown as unmatched.
  - `offered()` and `offerGarment` refuse a row without a cutout.
  - `photosOfPiece` and `wearAgain` need no change, since the row is `confirmed`.
- **Removing it**: the existing `PUT …/garments/:id` with `pieceId: null` on a hand-added row deletes the row instead of leaving an empty "unmatched". The view's action is "Remove from this photo".
- **Web**:
  - An "Add from my wardrobe" button under "What you're wearing" opens the same sheet, in add mode, which sends `AddPhotoPiece`.
  - A hand-added row shows the piece's own picture (`cdn.piece`), never an empty `src`.
  - A photo with no garments says "Styld didn't find any clothes in this photo" and shows the button.
- **Tests**:
  - Native `PhotosAcceptance.ts`: add by hand, then idempotent repeat, a stranger's piece → 404, a photo still being found → refused, then `/pieces/:id/photos` lists the photo, then Wear it again includes the piece, then remove.
  - Scene test for the empty photo and the add.
  - `MigrationSafety` for the rebuild.

**G3. Detection: a seated or cropped person.**

- In `Garments.ts:234-237` (`GarmentRules.ts:167` `wornBy`): when a person is found but none of the masks count as worn by them, fall back to every mask (as when nobody is found), so a photo never ends empty because the person filter was too strict.
- Unit tests in `GalleryPerson.test.ts`: a seated person whose top is 40% on their mask keeps it; a bystander case still drops the bystander when the foreground person wears something.
- Then check her real photos through G4.

**G4. Find Eva's photos again (operator, paid by Styld).**

- `POST /api/operator/photos/refind { email }`, behind the operator token (`Operator.ts`, alongside P2's backfill route). It queues each ready photo of the account on the piece queue as a re-find work item:
  - It has a new `PaidAttempts` key, `photo/<id>/refind/<n>`, and no credit hold.
  - It runs the same `garmentsIn`, then **merges**. Rows that are `confirmed` or `offered`, and rows added by hand, are kept. `suggested` and `unmatched` rows are replaced by the new findings. A new garment whose suggestion is a piece already confirmed on the photo is dropped. Positions continue after the kept rows.
  - The photo stays `ready` throughout, so the page never shows a spinner.
- An operator script in `tools/` (next to the importer) calls it and reports photos, garments before and after, and photos still empty. It is listed in `knip.config.ts`.
- **Native acceptance**: a seeded photo with one confirmed and one unmatched row keeps the confirmed row and gains the new finding. A second run with the same `n` does nothing. No credit is spent.
- **Cost**: one SAM and Clef pass per photo. Count her photos before running and report the estimate.

### Track D: delete from the wardrobe grid (background agent, own worktree)

**D1. Server: one batch delete, shared by HTTP and MCP.**

- **Protocol**: `POST /pieces/delete` with `{ operationId, pieceIds }`. The list has at least 1 entry and at most `piecesAtOnce = 50`, a new constant in `Limits.ts` beside `pinsAtOnce`. It returns NoContent, with errors NotFound, OperationConflict and Unavailable.
- **`Wardrobe.deletePieces`**:
  - Dedupe the ids, take the receipt with `identify` over the id list (as `removePins` does, `boards/Boards.ts:210-241`), and run `ownPieceIds` (`wardrobe/Store.ts:37`).
  - Pieces already gone are skipped, since that is the outcome the person asked for. A piece that belongs to someone else → NotFound, and nothing is deleted.
  - Delete the rows, their content checks and their uploads in one D1 batch, chunked under the 100-parameter limit (`kernel/Db.ts:17` `inChunks`). Then run the existing `forgetObjects` per piece prefix, after the rows (`Shared.ts:124`).
  - Refactor `deletePiece` (`Wardrobe.ts:397-415`, `Store.ts:350-362`) so that both use one row-deleting statement, which jscpd requires.
- **MCP**: a `pieces_delete` tool (the name rule `^[a-z]+_[a-z]+$` allows one underscore), with `destructiveHint` and "Ask the person before deleting". Update `ToolNames.ts`, `Mcp.test.ts` and `McpAcceptance.ts`. Update the `Wardrobe` fakes (`Wardrobe.test.ts:70`, `Mcp.test.ts:89`, `GenerationAdmission.test.ts:80`).
- **Tests**:
  - `Deletes.test.ts`: sent again → done once; another list under the same id → conflict; a stranger's piece → nothing deleted.
  - `DurabilityMigration`-style cascade seeding: looks, pins, items, worn and pictures go; `photo_garments.piece_id` becomes null.
  - Native `WardrobeAcceptance`: 204, GET 404, the R2 keys gone.

**D2. Web: Select mode on the grid.**

- New submodule `page/WardrobeSelect.ts`/`View.ts`, because `WardrobeView.ts` is at 462 of 500 lines.
  - Model: `Selection = Off | On { pieceIds, deletion: Confirm.Deletion }`, modelled on the board's `Ticks` (`Board/Model.ts:122`) and the Confirm states (`Confirm.ts`).
  - It is reset by `restore` (`Wardrobe.ts:137`) on a browse change.
- **View**:
  - A "Select" chip beside Filters on the type level. In Select mode each `pieceTile` becomes a `<button aria-pressed>` with a check overlay (the `Board/PickerView.ts:25` `pickButton` look) instead of a link.
  - A sticky bar above the floating tab bar shows "Delete {count} pieces" and "Done".
  - The confirmation is an in-page `role=alertdialog` section ("Delete 3 pieces? They leave your boards, looks and photos. This can't be undone."), using `confirmActions`.
- **Command**: `DeletePieces` draws its operation id once, and a retry after Failed resends the same id (Review's pattern, `Review.ts:331`). On success, Select mode ends and the app re-reads the pieces with a forced re-read (`readAgain`, not `revalidateOrLoad`), so the deleted cards disappear.
- **Copy** (en/sl with Slovenian `one/two/few/other`): `wardrobe.select`, `wardrobe.selectDone`, `wardrobe.deleteSelected`, `wardrobe.deleteSelectedConfirm`, `wardrobe.selectPiece`.
- **Tests**:
  - Story: tick/untick, confirm → Command, failure → retry with the same id, Done clears.
  - Scene: on the grid, Select → tick two → Delete 2 → confirm.
- **Phone-size screenshots**, dark and light. The bundle budget is measured.

## Working beside the other sessions

- The pictures, tops and boards tracks are run by `styldappv2-51`'s agents in `.claude/worktrees/agent-*`. Before starting, I'll message 51 with this plan's file list.
- **Overlaps to sequence**:
  - **`photo_garments` rebuild**: G2 and P4. Agree with 51 which lands first; the second regenerates its migration on top.
  - **`Board/*`**: G1 moves the picker out of the board, and B2/B3 edit the board. G1 lands early and small (the board only changes imports and wiring), and 51 is told so the boards agent rebases.
  - **Shared files**: the i18n catalogs, `WardrobeWords.ts`, `photos.*.test.ts`, the `Wardrobe` fakes in the server tests, and `Garment.ts` (tops). On each landing, rebase onto main and regenerate i18n from the catalogs instead of hand-merging generated files. In the shared checkout, stage only my hunks (hash-object + update-index).
- **Never**: stash, reset or restore another session's files, or deploy. 51 deploys and runs the operator re-find for Eva after deploying (G4's script); I hand over the command and the expected counts.
- **Tracker**: add T-22 (Gallery: Add from my wardrobe, sheet with categories and search, manual add), T-23 (Gallery detection: seated person, re-find old photos) and T-24 (Select and delete on the wardrobe grid) to `review.json`/`progress.json`, with criteria, Eva's words and the two screenshots copied to `evidence/` (her phone's screens are hers, so check with the owner before publishing them on the public tracker; the default is not to). STATUS and DELIVERY rows are updated as each piece lands.

## Order

1. Message 51 the plan. Start Track D's agent (D1 → D2) in its own worktree.
2. G1, which lands first and alone fixes the cardigan.
3. G2, once the migration order is agreed with 51.
4. G3, then G4.
5. Each track: full gate (`heavy --wait bun run check`) and native run once at the end, fix forward. Hand over to 51 for the deploy.
6. After the deploy: run the G4 re-find for Eva, read back her photos (how many are still empty), check the sheet and Select mode on a phone-size browser against the preview, and update STATUS, DELIVERY and the tracker.

## Verification

- **Unit/story/scene**: the picker Submodel, the Photo page (cardigan under "All", search, an empty photo, add by hand, remove), the Wardrobe Select mode, `GalleryPerson` for the seated fallback, `Deletes` for the batch delete, and `MigrationSafety` for the rebuild.
- **Native (workerd + Chromium)**: `PhotosAcceptance` (add by hand, refusals, In your photos, Wear it again), the re-find merge with no credit spent, `WardrobeAcceptance` batch delete with the R2 keys gone, and `McpAcceptance` `pieces_delete`.
- **Full gate**: `heavy --wait bun run check` on the final commit of each track.
- **Preview** (after 51 deploys):
  - `/api/health` release = HEAD.
  - On a test account: upload a seated photo and see garments; open a found garment, then "All", search "cardigan" and link it; add a piece by hand; Select → delete two pieces.
  - Then the operator re-find for Eva with its report: photos, rows kept, new garments, still empty.
