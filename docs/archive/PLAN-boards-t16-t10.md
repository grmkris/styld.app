# Plan: a board outfit kept as a look (T-16), then "One piece, six outfits" (T-10)

Planned 4 November 2026 on main at `717918c`, for the two Eva-review tickets nobody had built
(`docs/research/eva-review-tracker/`, findings F-26, F-29, F-30, F-33, F-38). The owner's answers of 4 November are
recorded below; everything else is a stated default. Nothing here is built yet.

## Owner decisions (4 November 2026)

1. **Engine and credits:** the six outfits are made by **Fast** (rules propose, Clef ranks), **free**, like every
   outfit today (ROADMAP › Credits). Thinking is not offered on boards in this slice; it can join after gate 1, the
   owner's rating of Fast against Thinking. Every make and keep is still counted per mode, so that readout stays
   possible.
2. **Layout:** six outfit clusters on the board's collage, **each holding the same anchor cut-out at the same size and
   angle**; the other pieces sit differently in each cluster (Eva's Samba reference, fig17). The collage stays freely
   editable.
3. **Keep and Another:** six **outfit cards under the collage**, each with Keep and Another. A kept card reads
   "Kept · Open look"; the look is in The Lab › Looks and pinned on the board. Another replaces that outfit and its
   cluster.
4. **A look stays its pieces:** a look saved from a board is the ordered list of its pieces, drawn in Styld's own
   flat-lay like every other look. No arrangement or paper is stored on looks.

## Defaults assumed (not asked)

- The anchor comes from the person's wardrobe only (ready pieces). A store screenshot as anchor is M5 "Before you
  buy", out of scope.
- A complete outfit is: a base (top and bottom, or a dress/jumpsuit, or a sport/lounge set), up to two tops (a knit
  or hoodie over a lighter top) and one outer layer, one pair of shoes, and **1–3 accessories** whenever the wardrobe
  has accessories that suit. Shoes and accessories are left out only when the wardrobe has none, and the card says
  so. A garment is never invented.
- "Complete" is a request option of the engine (`complete: true`). Today's Spin and swap keep their current rules.
- The six outfits differ from each other: the engine picks them from its ranked candidates to repeat as few
  non-anchor pieces as possible.
- The board's paper comes from the anchor's main colour through a fixed table onto the six existing papers (`paper`,
  `stock`, `sand`, `sage`, `slate`, `clay`), unit-tested. No model call.
- The chooser asks for an optional season (Any, Spring, Summer, Autumn, Winter; default Any). No other brief in this
  slice.
- A small wardrobe gets as many complete outfits as it can make (fewer than six is allowed) and the page names
  what is missing. With none at all, no board is made and the chooser says what to add.
- The board's name is "<anchor name or type>: six outfits", from the browser's catalog like today's default name; it
  can be renamed as any board.
- The chooser shows exactly two choices, **Blank** and **One piece, six outfits**. No "coming soon" tiles. Ask's +
  sheet opens the same chooser.
- A look kept from a card is named "<board name> · <n>" (n = the card's position). Looks have no rename yet.
- T-16 on any board: the collage editor gains a **Select** mode (a toolbar toggle, so ticking never fights dragging).
  Selected pieces are saved with "Save as a look"; with nothing selected it saves every piece on the table, as now.
  Either way the look is now also pinned on the board.
- Another never touches a kept outfit (it is a look now); Keep on a card that was edited in the collage keeps the
  card's pieces, not the collage's.
- Deleting the anchor piece leaves the board (template and outfits read "the piece was deleted"; Another is off).
  Deleting a kept look makes its card keepable again.
- No MCP tools in this slice: assistants already have `look_create` and the board pin tools. A `board_outfits_make`
  tool is a later, separate decision.
- The existing "Make with Styld" mood board stays as it is (its removal is ROADMAP business, not this plan).

## Milestones, in order

Each milestone lands on main as its own green commits (cheap gates per commit, full gate once at the end, per
`docs/DELIVERY.md` and the batch-verification rule). Migrations are ADD COLUMN or new tables only;
`MigrationSafety.test.ts` must pass and the generated SQL is read before committing (no drizzle table rebuild, no new
table-level CHECK on an existing table, since that makes drizzle rebuild it).

### M1 — Keep a look on a board (T-16, server)

- **Protocol** (`packages/protocol/src/Board.ts`): `KeepLook` payload `{ operationId, name, pieceIds (1–12),
  outfitId?: BoardOutfitId, proposal?: ProposalRef }`, answer `{ look: Look, board: Board }`; endpoint
  `POST /api/boards/:boardId/looks` (`keepLook`) in the board group, errors NotFound, PinRefused (boardFull),
  OperationConflict, Unavailable. `outfitId` is accepted from M4 on; M1 refuses it as NotFound.
- **Server** (`boards/Looks.ts` or within `Boards.ts` → a new file if `Boards.ts` passes its line budget): own board,
  own pieces, then **one D1 batch**: the look and its pieces (statements from `LookStore`), its pin on the board
  (`BoardStore`), the operation receipt; the board's `updatedAt`. A repeat answers the same look; a repeat after the
  look was deleted is OperationConflict, as `createLook` does. With a `proposal`, `outfitKept(…, 'kept')` is counted.
- **Data:** none (looks, look_pieces and board_pins exist).
- **Credit:** free.
- **Tests:** native workerd (`packages/server/test/`): keep → look listed in `/api/looks`, pinned on the board, one
  batch (a failed batch leaves neither); replay answers the same look; a foreign piece or board is 404; a full board
  refuses; deleting the look unpins it.

### M2 — Select and save as a look in the collage editor (T-16, web)

- **Foldkit** (`apps/web/src/page/Board/`): a `Select` toolbar toggle; in select mode a tap ticks or unticks an item
  and gestures are off; the bar shows "Save 3 as a look". `SaveLook` calls `keepLook` instead of `createLook`. The
  saved state keeps its "Open look" link. `Model.ts`'s single `maybeSelectedId` stays for the transform handles;
  the ticked set is its own field. Files near their 500-line limit (`PageView.ts` 474) get a submodel rather than
  growth.
- **Copy (en/sl, x18n):** `board.select`, `board.selectDone`, `board.saveSelectedLook` (`{count, plural, …}`),
  `board.lookSavedPinned`. The existing `board.lookSaving/lookSaved/lookFailed/openLook` stay.
- **Tests:** Story tests for select mode (tick, untick, gestures off, Save with none/some ticked, failure). Native
  Chromium: the Gallery browser journey's editor step ticks two pieces, saves, and finds the look in Lab › Looks and
  on the board's pins.

### M3 — Complete outfits in the engine (T-10, engine)

- **Protocol:** `MakeOutfit.complete: optionalKey(Boolean)`.
- **Rules** (`outfits/Rules.ts`, pure): with `complete`, at least one accessory when the accessory pool suits the brief,
  at most three (the accessory place holds 3 instead of 2), shoes as today; Fast's draw then wears 1–3 accessories
  (two most often) instead of by chance. `validated` stays the one validator for both ways.
- **Distinct batch** (`outfits/Outfits.ts`): with `complete`, the slice of ranked candidates is chosen greedily to
  share as few non-anchor pieces as possible, Clef's order breaking ties; Fast draws more candidates for it
  (`mostCandidates` stays the Clef wave size; judged within `judgingBudget`).
- **Thinking's prompt** says "complete" too, so the rules and the model agree when Thinking joins boards later.
- **Tests:** unit — every complete outfit wears the anchor, a base, shoes when owned, 1–3 accessories when owned; a
  dress anchor gets no bottom, a top anchor gets a bottom; an accessory anchor counts toward the three; a wardrobe with
  no accessories still answers and reports nothing invented; six outfits from a 40-piece fixture repeat at most the
  pieces the wardrobe forces; Today's requests (no `complete`) answer exactly as before (existing tests unchanged).

### M4 — The outfit board on the server (T-10, data and operations)

- **Data** (`packages/db/src/boards.ts`, one new migration):
  - `boards.template` text, nullable (`outfitsAround`; null for a blank board). Read through the Board schema; no
    table CHECK (that would rebuild `boards`).
  - `boards.anchor_piece_id` text → `pieces.id` ON DELETE SET NULL.
  - New `board_outfits`: `id` (`bo_`), `account_id` → accounts CASCADE, `board_id` → boards CASCADE, `position` 0–5
    (unique per board), `mode`, `session`, `look_id` → looks ON DELETE SET NULL, `created_at`.
  - New `board_outfit_pieces`: `outfit_id` → board_outfits CASCADE, `piece_id` → pieces CASCADE, `position`; primary
    key (outfit, piece).
  - `board_items.outfit_id` text → board_outfits ON DELETE SET NULL: which cluster an item belongs to, so Another
    replaces exactly that cluster's items.
- **Placement** (`packages/protocol/src/Placement.ts`, shared and pure): `outfitsAround(anchor, outfits, seed)` lays up
  to six clusters on the table, each with the anchor at one size and angle and the rest placed by a seeded variant
  (shoes beside or below, a bag left or right, jewellery small and high), never overlapping another cluster, inside
  the table. `paperFor(colours)` picks the paper.
- **Operations** (board group, one writer each, idempotent by operation id with receipts):
  - `POST /api/boards/outfits` (`createOutfitBoard`): `{ operationId, name, anchorPieceId, season? }` → Board. Owns
    the anchor, asks `Outfits.make` (Fast, complete, anchor, count 6, derived operation id), and then writes the board
    row, its outfits and their pieces, the laid-out items, the implied pins and the receipt **in one D1 batch**. No
    outfit → a new typed error `OutfitsUnavailable { missing: Slot[] }` with an assistant guide, and no board.
  - `POST /api/boards/:boardId/outfits/:outfitId/another` (`replaceBoardOutfit`): `{ operationId, seen: OutfitKey[] }`
    → Board. Refuses a kept outfit; asks the engine with the anchor, `complete`, and `seen` plus every current
    outfit's key; rewrites that outfit's pieces and its cluster's items in place and moves the board's version on,
    so an editor open on an older version rereads (the existing conflict path). Pins follow the table as
    `saveBoardItems` does today.
  - `keepLook` (M1) accepts `outfitId`: it also sets that outfit's `look_id` in the same batch.
  - The Board contract gains `template`, `anchor` (a piece or null) and `outfits` (`id`, `position`, `pieces`,
    `lookId`, `mode`, `session`).
- **Credit:** free; at the account's outfit pace (`Pacing.account('outfit')`) like any make.
- **Tests:** unit for `outfitsAround` (six clusters within the table, the anchor identical in all, no overlaps,
  deterministic per seed, different placements between clusters, one to five clusters) and `paperFor`. Native
  workerd on real D1 (`OutfitBoardAcceptance.ts`): a seeded wardrobe yields a board with six complete outfits, the
  collage and pins; replay answers the same board and counts one make; a foreign or deleted anchor 404; a top anchor
  with no bottoms in the wardrobe answers `OutfitsUnavailable` and leaves no board; Another gives a combination not
  shown before and refuses a kept card; Keep with `outfitId` marks the card; deleting the look unmarks it; deleting the
  anchor sets it null and keeps the board; deleting the board or the account removes every new row;
  `MigrationSafety.test.ts` passes on the new migration.

### M5 — Outfit cards on the board page (T-10, web)

- **Foldkit:** a submodel `Board/Outfits.ts` with `OutfitsView.ts`, shown under the collage on a template board:
  one card per outfit (its pieces as a small flat-lay), **Keep** and **Another**, states Idle / Keeping / Kept (link to
  the look) / Replacing / Failed. Another reloads the board (its collage changes). Shown keys for `seen` live in
  the page's model for the visit. With fewer than six, a line names what is missing ("Add shoes and accessories to
  your wardrobe for more outfits"). The anchor deleted: cards show, Another is off, a line says why.
- **Copy (en/sl):** `outfits.title`, `outfits.keep`, `outfits.another`, `outfits.kept`, `outfits.openLook`,
  `outfits.keeping`, `outfits.replacing`, `outfits.failed`, `outfits.missing` (list of places), `outfits.anchorGone`,
  `outfits.lookName` (`{board} · {n}`).
- **Tests:** Story tests for each card state and the missing and anchor-gone lines.

### M6 — The template chooser (T-10, web)

- **Foldkit:** `+` on Boards (and Ask's + sheet) opens a chooser sheet (`@foldkit/ui` Dialog) instead of creating a
  board. **Blank** does what `+` does today. **One piece, six outfits** opens the anchor step: the person's ready
  pieces by type (reusing the board's piece picker in single-choice form), the season chips, then **Make six
  outfits**. While the board is made (about 4 s warm), the sheet says so; on success the board opens, on
  `OutfitsUnavailable` the sheet lists what to add, on SlowDown or failure it offers to try again with the same
  operation id. A shared `BoardStart` submodel serves both Boards and Ask.
- **Copy (en/sl):** `boards.chooserTitle`, `boards.templateBlank`, `boards.templateBlankHint`,
  `boards.templateOutfits` ("One piece, six outfits" / "En kos, šest outfitov"), `boards.templateOutfitsHint`,
  `boards.pickAnchor`, `boards.season*`, `boards.makeOutfits`, `boards.making`, `boards.outfitsMissing`,
  `boards.outfitsBoardName` (`{piece}: six outfits`).
- **Native journeys realigned:** `GalleryBrowserAcceptance.ts` clicks "New board" and expects a blank board; it
  now chooses Blank in the chooser. Any other journey that opens a board this way is realigned in the same commit.
- **Tests:** Story tests for the chooser (Blank, anchor step, season, making, missing, retry with the same operation
  id). Native Chromium journey: Boards `+` → One piece, six outfits → pick a seeded top → the board shows its
  clusters and six cards → Keep one → Lab › Looks lists it and the board's pins show it → Another on another card
  changes its pieces.

### M7 — Batch end

- `heavy --wait bun run check` (full gate including native) once on the batch; the bundle budget raised only by a
  measured amount (main has about 140 bytes of headroom: the chooser and cards go in the Boards and Board chunks,
  not the initial bundle, wherever Foldkit's routing allows).
- `docs/STATUS.md`, `docs/DELIVERY.md` (studio and outfits rows), the tracker's `progress.json` (T-16, T-10 partial:
  templates 2–5 open) with before/after screenshots, as every completed ticket needs.
- Deploy and readback belong to the coordinator session once the Alchemy state-store decision lands. Readback on the
  preview with a **test account and a seeded, non-personal wardrobe** (no production personal data on the public
  preview): the time for six complete outfits warm and cold, whether Clef ranked within its budget, a Keep, an
  Another, screenshots for the tracker. Eva's phone acceptance follows.

## Evidence levels

| Behaviour                              | Unit | Story | Native workerd | Native Chromium | Preview readback |
| -------------------------------------- | ---- | ----- | -------------- | --------------- | ---------------- |
| Keep a look on a board (batch, replay) |      |       | ✓              | ✓               | ✓                |
| Select mode in the editor              |      | ✓     |                | ✓               |                  |
| Complete outfits, distinct batch       | ✓    |       | ✓              |                 | ✓ (real Clef)    |
| Layout and paper                       | ✓    |       | ✓              | ✓ (visible)     | ✓ (screenshot)   |
| Create/replace an outfit board         |      |       | ✓              | ✓               | ✓                |
| Cards and chooser states               |      | ✓     |                | ✓               | ✓                |
| Deletions and migration safety         | ✓    |       | ✓              |                 |                  |

## Risks

- **Outfit quality on real wardrobes.** Eva's types and colours are partly wrong until T-02's `--apply` runs after
  the deploy; wrong places make wrong outfits whatever the template does. The readback should use a clean seeded
  wardrobe first, Eva's own only after T-02 is applied.
- **Accessories are thin in most wardrobes.** "1–3 accessories" degrades to none for many people; the card says
  what is missing rather than inventing anything.
- **Clef's 4-second budget.** Complete outfits carry more pieces, so more pictures are read; a cold wardrobe answers
  in the rules' order unranked. Measured on the preview, not tuned blind.
- **Diversity.** Without the distinct pick, six outfits would often share the same shoes; it is unit-tested on a
  fixture, and checked by eye on the preview.
- **Gate 1 is skipped for boards.** Fast only, per the owner; mode metrics keep the later comparison possible.
- **The `+` change breaks native journeys** that expect a blank board; realigned in M6's commit.
- **Shared files.** The T-12 session may add category rename/delete UI (`Piece.ts`, wardrobe words, catalogs).
  This plan does not touch `Piece.ts`; catalog and generated i18n files are staged by hunk around concurrent edits.
- **Bundle headroom** is about 140 bytes; the new UI must load with the Boards/Board pages.
- **Versioned table edits.** Another changes the collage while an editor may be open; it uses the existing version
  conflict, which the native test covers.

## Out of scope

The Wishlist board (F-31) and M5 "Before you buy" with screenshot cut-outs; the week/trip, outfit-of-the-day and blank
lookbook templates (F-32); Thinking on boards; a model-chosen background; per-piece lock or swap on a card (Today's
swap exists; later); exporting a board as a picture; the piece page's "Create board"; MCP tools for template boards;
"variations of a look"; renaming looks; removing the generated mood board.
