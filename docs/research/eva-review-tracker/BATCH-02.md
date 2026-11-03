# Eva board batch 02 — 3 November 2026

Status: deployed to the isolated preview; full gate and exact-release smoke acceptance passed. T-04, T-09 and
T-11 are verified, with physical-device and live-provider feedback kept separate.
Tracker: https://styld-review-07c26b483ccc.pages.dev

## Scope

- T-04: one Bring to front / Send to back control; selection and dragging preserve the chosen layer. Normal
  image compositing makes the visible overlap agree with the saved order. New pieces land on top.
- T-09: owned boards open directly on the editable table at either board address. Add to board places missing
  pieces and a look's pieces, preserving existing positions. Gallery photos place their private picture.
  Pins, sharing, rename and removal remain in Edit; visitors retain their read-only public presentation.
- T-11: Add your piece replaces the inline wardrobe strip with a category/type bottom sheet. Choosing a category
  clears the old type; only populated types appear. Tapping a piece adds/selects it and closes the sheet.

No paid providers, real account data, schema migrations, v1 or production resources are involved in this batch.
The original report remains untracked. Original finding text and ticket bodies are preserved; tracked checklists
were added for T-09 and T-11.

## Review and validation

- Focused board scenes/stories passed. A deliberately retained category type made the new filter scene fail;
  the exact source was restored. The final unit run passed 759 tests in 119 files.
- Native API placement and photo-privacy checks passed: concurrent identical requests create one placement;
  later repeats preserve positions; stale editor saves conflict; foreign pieces/boards are refused; visitors
  cannot see a gallery photo's pin, table picture or public image route.
- The final screenshot harness passed 1 test / 49 assertions at both 390×844 and 1440×844: visible front/back
  hit order, layer-preserving selection/drag/reload, Shoes → Boots filtering, addition and sheet dismissal,
  persisted top-layer placement, and nested Edit/pin-picker Escape dismissal. It uses the built website
  through local workerd and Chromium, with three synthetic transparent silhouettes.
- Architecture/tooling review: pure Foldkit views and named Commands; the existing BoardStore remains the
  writer. Pins, items, board version and the placement operation receipt commit in one D1 batch, with bounded
  reread/retry on a racing editor. Omitted/false placeOnTable retains the earlier receipt fingerprint.
- Durability/privacy review: ownership is checked server-side. Existing layouts are retained, existing canvas
  pieces are not duplicated, and only new pins count toward the placement limit. Pin mutations wait for local
  saves/uploads; table replacement clears obsolete undo history. Gallery photo upload and placement use stable
  operation ids, and their origin remains private. The board's global shortcuts/paste/drop pause under sheets.
- Product review: all six before/after pairs were visually inspected. The phone header keeps Edit beside Back;
  save/make actions wrap separately. The direct editor's pointer/key subscriptions follow ownership, so visitors
  receive the read-only presentation and retain navigation.

The completed `heavy --wait bun run check` exited 0: 759 unit tests in 119 files and 29 native tests /
1,284 assertions. The earlier attempts stopped on stale assistant output and obsolete scene expectations;
these were corrected before the completed run. Exact-release preview smoke acceptance passed (3 tests / 42
assertions) on `021dabe`. Browser viewports,
local native fixtures, deployed smoke acceptance and physical-device/live-provider acceptance are distinct.

## Before and after

`evidence/batch-02/` contains six pairs (12 PNGs), attached to T-04, T-09 and T-11 at 390 and 1440px widths.
Before uses the batch-01 `c05071e` website artifact, captured from checkout `e61e358`. After uses this batch's
final built artifact; the application commit is recorded with deployment below. The synthetic board starts
with overlapping red/blue pieces and off-table pinned boots. T-09 compares opening that same board. The API and
native browser journeys separately prove placement from Add to board. The baseline click diagnostic did not
reproduce automatic raising; that cause was identified in source and covered by the layer history regression.

Captures keep the same viewport dimensions. T-04/T-09 use full-page captures; T-11's after image captures the
viewport to keep the fixed bottom sheet in context. Image heights can therefore differ. These are not screenshots
from a physical phone, a tester's private account or a live-provider run.

## Deployment

Application commit: `021dabe15e060fe114317beffd5913b9851a0885`. Alchemy deployment completed on 3 November at 08:52 UTC:
three successful Worker updates and two release-binding changes. D1/R2/queues and Durable Object namespaces
were unchanged; no migrations, resource deletions or custom domains were planned or applied.

Preview: https://styldappv2-styldedge-preview-le7xsbk4pgfxkm7o.kristjan-grm11775.workers.dev

Exact-release smoke acceptance passed: 3 tests / 42 assertions for health/release, API/auth/CSRF, the hydrated
website, MCP discovery/challenge/registration and immutable assets. The API Worker's release binding matches.
Cloudflare readback confirms the edge alone exposes workers.dev, while API/SSR workers.dev and preview URLs
are disabled; no custom domains are attached. All three deployments are at 100%:

- Edge: `d73b9610-dfd2-496f-90b9-256cab9a9871`
- SSR: `9fa94003-bd78-4f2e-a962-9d2fe95b7901`
- API: `d7b2f396-1cf5-49d6-97c4-efdf558cd06a`

The release-stamped build passed bundle budgets: initial browser 348,718 gzip bytes; all browser 612,759;
SSR 2,035,660 source bytes. The smoke harness's outer zsh wrapper failed after the test completed because it
used the reserved `status` variable; the test log records all 3 passing tests and zero failures. No full-suite
rerun was needed. Signed-in board acceptance uses local native fixtures; this deployment did not inspect a real
user's private wardrobe or call paid providers.

T-04/T-09/T-11 and F-19/F-20/F-36/F-37 are independently verified in the tracker. T-05/T-15 remain partial.
