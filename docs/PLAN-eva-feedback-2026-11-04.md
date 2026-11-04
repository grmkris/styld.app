# Plan: Eva's 4 November feedback (shop-style pictures, a picture carousel, tops by sleeve, boards)

Owner decisions, 4 November 2026: a piece shows its drawn shop-style picture by default with the original one swipe
away; every piece gets one; Tops & T-shirts splits into three built-in types by sleeve; an outfit board puts its
piece big in the middle with whole outfits, shoes included, laid out around it in one of several layouts. Source: Eva's messages and
screenshots of the new preview (her words: "redo it without the wrinkles, as if it were in a shop"; "it only cuts
them out"; "I'd split tops and T-shirts into short, long and sleeveless"; on boards: "the outfits are semi OK, but
it has to lay them out together better", "every outfit needs shoes", "the piece I pick should appear big in the
middle").

## What is wrong today

- Muse draws a clean picture a minute or so after a piece is kept, and Clef compares it with the cut-out. At 0.8 or
  above it is shown; between 0.5 and 0.8 it is only proposed and waits on the piece page, below the facts, under the
  floating tab bar. Of Eva's 58 drawings, 8 were shown, 42 wait unseen, 4 were rejected and 4 failed. To her, Styld
  "only cuts them out".
- About 310 of her 368 pieces (older captures, the v1 import) never had a picture drawn.
- On the piece page the floating tab bar covers the last rows (When it's worn, What it's for).
- Tops & T-shirts holds short sleeves, long sleeves and tank tops together (her 56 tops).

## Milestones (one commit per green piece, cheap checks per commit, the full gate once at the end)

**P1: shown by default (server).** A drawing that passes the reject bar (0.5) and shows no face is shown; the
`proposed` middle goes. `capture/CleanPicture.ts` `gateFor` and `Policy.ts` `pictures` say so, with the reason (Eva's
numbers above). The 42 proposed pictures in existing data become shown through the same rule (a data migration or
the backfill job, whichever keeps `Shown.ts`'s meaning clean). The person can still choose the photo per piece
(`ChoosePicture`), and that choice is kept. Unit tests for the gate; the clean-picture native journey updated.

**P2: a picture for every piece (operator).** `POST /api/operator/pictures/backfill` (operator token, `Operator.ts`)
queues a clean picture for each ready piece of an account (by email) that has none, on the existing picture queue at
its existing pace, paid by Styld (never the person's credits), idempotent per piece. An operator script beside the
importer runs it and reports counts. About $0.01 a picture (Muse), so about $3 for Eva. Native acceptance: a seeded
account's pieces without pictures get one, a second run queues nothing.

**P3: the picture carousel (piece page).** The picture box is a swipeable carousel (scroll-snap with dots, as T-17's
Gallery photo does): the shop-style picture first, then the person's photo, then the plain cut-out, then the back
when there is one. While a drawing is being made, its slide says so ("Making a shop-style picture…") instead of a
proposal further down. "Use this as the main picture" on a non-default slide sets what the wardrobe shows (existing
`ChoosePicture`). The page reserves room under its last row for the floating tab bar. en/sl copy through x18n;
story and scene tests; the native piece journey and a phone-size screenshot in dark and light.

**P4: tops by sleeve (types).** Tops & T-shirts becomes three built-in types in Clothing: T-shirts & short-sleeve
tops, Long-sleeve tops, Tank tops & camisoles (en/sl names, Clef criteria by sleeve). The type CHECK changes, so the
migration rebuilds `pieces`, `detections` and `photo_garments` by T-12's keep-aside pattern with 0eedb270's fix (put
back only the rows the drop deleted), proven on a copy of the preview's real data before it is committed
(MigrationSafety). Existing `tops` are re-typed by Clef's sleeve answer through an operator script like
`retype-pieces.ts`: a dry run first, a sample checked against the pictures by eye, then `--apply`. The v1 importer's
mapping sends v1 tops through the same sleeve question.

**B1: shoes in every outfit.** A complete board outfit always wears shoes when the wardrobe has any: shoes that
suit the brief's season and occasion first, any other shoes (not sport shoes outside sport) when none suit. Today
`outfits/Rules.ts` treats shoes as optional and an empty seasonal pool leaves them out (Eva: "it does not add shoes").
Rule tests for the fallback; the board native journey asserts shoes in every cluster.

**B2: the anchor big in the middle, outfits laid out together.** `Placement.ts` `outfitsAround` is replaced by layouts
after Eva's Pinterest references (fig14, fig15, fig17 in `docs/research/eva-review-tracker/evidence/`) and her own
rearranged board: the anchor piece large in the centre, and around it each outfit as one tight flat-lay (outer layer
overlapping the top, the bottom beside it, shoes at its foot, the bag and accessories tucked against it, not apart).
The anchor also repeats, smaller, inside every outfit (owner, 4 November). Three layouts (owner: "a bit of randomness"):
eight outfits on a 3×3 grid around the centre (fig17), six in a radial ring (fig15), six on a 3×3 grid whose middle row
leaves the anchor room. A board picks one at random when made, and "Another layout" deals a new one. The number of
outfits follows the layout, so the template is renamed "One piece, many outfits" / "En kos, več outfitov". The board's
paper starts light, as in every reference. Pure layout tests (no overlap between clusters, every piece inside the
board, the anchor largest); a native screenshot of each layout on a phone, light and dark.

**B3: kept outfits and cards follow.** Keep/Another and the outfit cards (T-16/T-10) work with six or eight clusters;
Another replaces one cluster in place within the current layout.

**P5: release.** Full gate; deploy; readback of the pictures (a new scan shows its drawing within a few minutes), the
backfill for Eva, the carousel on a phone, the three tops cards; STATUS, DELIVERY and the tracker; Eva re-checks.

## Order and who

Three tracks in separate worktrees, side by side: pictures (P1 → P2 → P3, in order: the carousel shows what P1
decides and the backfill uses its rule), tops (P4) and boards (B1 → B3). Boards and tops both touch
`outfits/Rules.ts` and the type lists, so the later one rebases on the earlier. The deploy waits for all three.

## Out

Generated pictures for other people's pieces; a redraw hint UI beyond what exists; per-piece sleeve as a filter
(the three types replace it).
