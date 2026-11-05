# One-off operator scripts

Backfills and re-sorts run by hand against a deployed stage for one change, kept here while someone may need to run
them again. Knip takes every lowercase `*.ts` here as an entry (`knip.config.ts`), so a new one needs no entry of its
own: add it to this list instead. Delete a script once its change is settled; git keeps it. The ongoing operator
tools (`grant-membership.ts`, `import-v1/`, `provider-live.ts`, `preview-capture.ts`, `ai-usage-report.ts`, `seed/`)
stay in `tools/`.

- **`retype-pieces.ts`** (`cf7c8a60`, 3 November, T-02): runs the Worker's `suggest` on an account's stored cut-outs
  (with the original beside each since `668fc696`) and writes only moves into T-12's new types and a shoe's trim
  colour. Ran read-only on Eva's 310 pieces on 3 November (11 moves, checked by eye); `--apply` on the preview was
  left open.
- **`retype.ts sleeves`** (`b66c378b`, 4 November, P4): asks each short-sleeved top only about its sleeves and moves it
  to long-sleeved or sleeveless on a sure answer. Not recorded as run against any database.
- **`retype.ts sport`** (`4c9c846a`, 4 November, the four Sport types): asks each sport top, beside the photo it was cut
  from, which kind of sportswear it is, and moves it to sports bras, sport bottoms or tracksuits. Ran on Eva's
  production account on 5 November: 40 read, 25 moves checked by eye and applied (`edcf4917`). The preview's copy is
  open.
- **`backfill-pictures.ts`** (`c5ec09c3`, 4 November): queues a shop-style picture for every piece of an account
  without one; `--redraw` draws again every drawing made before its start (`42911477`), `--ended` only the rejected or
  failed ones. `--redraw` was started for Eva, Andraž and Ivona on 4 November; Eva's redraw in one style and `--ended`
  for the testers are open (docs/STATUS.md).
- **`relayout-boards.ts`** (`e38e01fd`, 4 November): lays out an account's outfit boards again, centred, once per
  board. Ran on production on 4 November: Eva's 4 of 4 boards, Kris's and one imported account's 1 each. Several
  emails in one run answered 404 for the first; one email per run works.
- **`refind-photos.ts`** (`0faaeb55`, 4 November): finds an account's ready Gallery photos again with today's
  detector, at Styld's cost, keeping what the person decided. Ran once for Eva on the preview at `679e8d09`: 7 photos
  ready, 13 garments.

`retype.ts` replaces `retype-tops.ts` and `retype-sport.ts` (5 November): they were one script with two questions,
now the `sleeves` and `sport` sets in `Questions.ts`. Its report names the answer `choice` where the old reports said
`sleeve` or `kind`, and it takes `--before` for both sets. `../CloudflareRest.ts` holds the D1, R2 and Clef calls the
re-sorts and the house seed make through Cloudflare's REST API.
