# Plan: Eva's 4 November feedback (shop-style pictures, a picture carousel, tops by sleeve)

Owner decisions, 4 November 2026: a piece shows its drawn shop-style picture by default with the original one swipe
away; every piece gets one; Tops & T-shirts splits into three built-in types by sleeve. Source: Eva's messages and
screenshots of the new preview (her words: "redo it without the wrinkles, as if it were in a shop"; "it only cuts
them out"; "I'd split tops and T-shirts into short, long and sleeveless").

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

**P5: release.** Full gate; deploy; readback of the pictures (a new scan shows its drawing within a few minutes), the
backfill for Eva, the carousel on a phone, the three tops cards; STATUS, DELIVERY and the tracker; Eva re-checks.

## Order and who

P1 → P3 depend on each other (the carousel shows what P1 decides); P2 needs P1's rule; P4 is independent. P4 and
P1–P3 can run side by side in separate worktrees; the deploy waits for both.

## Out

Generated pictures for other people's pieces; a redraw hint UI beyond what exists; per-piece sleeve as a filter
(the three types replace it).
