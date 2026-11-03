# Publication evidence, 3 November 2026

- Stable URL: https://styld-review-07c26b483ccc.pages.dev
- Deployment: https://2cf76bbf.styld-review-07c26b483ccc.pages.dev
- Published 46 static files plus Pages `_headers`; no Functions, bindings, domains or application resources.
- Manifest: 51 findings, 21 tickets, 35 screenshots; reviewed code `d73475c`.
- Review JSON SHA-256: `141581822851b269b408ca3c31ff339e2da41f6c51f0f2872389ca8b76c4cf04`.
- Initial statuses: all findings and tickets `not_started`, no acceptance claimed.

## Checks actually run

- Build validates stable contiguous IDs, all findings covered by tickets, one workstream per ticket, progress IDs,
  statuses, checklist indexes and screenshot references. Three deliberately invalid progress fixtures (verified
  without evidence, missing ticket, nonexistent criterion) were correctly refused.
- Focused Oxlint and the pinned `tsrs` compiler passed `client.ts` with no suppressions.
- Complete `heavy --wait bun run check` exited 0 on the working tree based on `264fb5e`: 753 unit tests in 119
  files, 29 native tests, format/architecture/lint/type/bundle gates passed. Later document review fixes changed
  only the stage summary, source metadata, tap-target CSS, 404 styling and these delivery notes.
- Local and public Chromium journeys passed: all counts; workstream links; finding-to-ticket navigation; Back;
  search; empty results; Reset; search restored after reload; direct links overriding conflicting filters;
  every original image decoded; reading with JavaScript disabled; no page or console errors.
- Public layout checks covered 320, 375, 390, 768, 1440 and 1920px, with no document overflow. Related ID targets
  measured at least 44px in each dimension. Screenshots were visually inspected at phone and desktop sizes.
- Live HTTP 200, CSP with the inline script hash, `font-src 'self'`, noindex/nofollow/noarchive, nosniff,
  no-referrer and frame denial headers were read back. The browser ran under this deployed CSP.

## Review outcome

Hallmark's independent finish reviewer found two issues: stage copy could become inconsistent with updated
progress, and related-ID links had small tap targets. Both are resolved: the stage heading and note now live in
`progress.json.overview`, documented in the update workflow; related links have 44px targets. Architecture and
publication review found no additional isolation/security blocker.

Hallmark's rendered app-screen scan passed with zero failures or reflex findings. Four numeric-type warnings
were false positives: the selectors use the shared tabular-nums rule. Static source scanning flags seven emoji
occurrences in the original evidence (trash, magnifier and sparkle icons being discussed), plus source punctuation.
These are preserved quotations, not the tracker's iconography; preserving the user's report takes precedence
over rewriting that evidence to satisfy the style scanner. No decorative emoji were added to the UI.

This is browser and publishing evidence for the document. It is not live-provider, authenticated Styld,
physical-phone or acceptance evidence for any of the findings. No message was sent to Eva.

## Batch 01 publication — 3 November 2026

- Tracker source commit `f943415`; deployment https://4ec6b90a.styld-review-07c26b483ccc.pages.dev;
  stable URL unchanged. Pages uploaded 23 changed/new files and reused 41 (64 static files plus headers).
- The public document has 51 findings, 21 tickets, 35 original screenshots and 9 before/after pairs (18 new PNGs).
  T-13 is verified; T-15 and T-05 remain in progress with explicit partial scope. Five findings are verified.
- Public Chromium readback passed the three ticket statuses, all 18 comparison images, 320/390/1440px layout,
  direct ticket links, search/reset and JavaScript-disabled comparison reading, with zero browser errors.
  The public response carries the expected CSP and noindex headers.
- The comparison policy refuses a completed ticket without screenshots, a missing image and mismatched viewport
  widths. Original finding text and all original ticket bodies were compared against `c5d6f52` and are intact;
  only the tracked checklists of the three active tickets were added.
- Application release `c05071e` passed the full gate (755 unit, 29 native / 1,276 assertions), deployed to the
  isolated preview, and passed release smoke readback (3 tests / 42 assertions). See `BATCH-01.md` for exact scope,
  screenshots, Worker deployment ids and evidence boundaries. Physical-phone and real-provider acceptance are
  separate. This publication adds no application changes beyond that tested release.

## Board batch 02 publication — 3 November 2026

- Tracker source commit: `7a3371c`; deployment https://6b8a9b00.styld-review-07c26b483ccc.pages.dev.
  Stable URL remains https://styld-review-07c26b483ccc.pages.dev. Pages uploaded 10 changed/new files and reused
  66 (76 static files plus headers).
- The public document now contains 51 findings, 21 tickets, 35 original screenshots and 15 before/after pairs.
  T-04, T-09 and T-11 are verified; F-19, F-20, F-36 and F-37 are independently verified. T-05 and T-15 remain
  partial with their open follow-ups.
- Local build passed with all IDs, criteria, evidence and 15 comparison pairs. `bun run format:check` and
  `git diff --check` passed. The original report and ticket bodies remain unchanged.
- Application release `021dabe15e060fe114317beffd5913b9851a0885` deployed to the isolated preview. Exact-release smoke
  acceptance passed: 3 tests / 42 assertions. Cloudflare readback found the edge public, API/SSR private, no custom
  domains and 100% traffic on each deployment. This is not authenticated real-user, physical-phone or paid-provider
  acceptance.
- Public Chromium readback passed T-04/T-09/T-11 verified statuses, all 12 new comparison images decoded at
  320/390/1440px, no document overflow, search/reset and JavaScript-disabled comparisons. CSP/noindex headers
  were present; no page or console errors occurred. The first harness waited indefinitely on a lazy image;
  scrolling images into view and bounding the decode wait fixed the harness. No site change was needed.

## Camera batch 03 publication — 3 November 2026

- Tracker source commit: `39cb762`; stable deployment remains https://styld-review-07c26b483ccc.pages.dev.
  The camera update uploaded the changed tracker assets and reused the existing static files. The document contains
  51 findings, 21 tickets, 35 original screenshots and 19 before/after pairs.
- T-01 and T-05 received four matching synthetic camera pairs each at 390×844 and 1440×844. F-49 is verified
  at the native and exact-release preview-smoke boundary; T-01/T-05 remain partial. T-21 remains not started and
  explicitly records the remaining signed-media migration plus authenticated load evidence.
- The tracker build passed its data/IDs/evidence/image checks. `bun run format:check` and `git diff --check` passed.
  The public Chromium readback checked T-01, T-05, T-21 and F-49 at 320/390/1440px, decoded all 14 camera
  comparison images, verified search/reset, Back, JavaScript-disabled reading, no overflow, CSP/noindex headers
  and no page or console errors.
- Application release `15ddacaca5105bf0f7c7b8b33cb2ba396a24deeb` is deployed separately to the isolated preview;
  its exact-release smoke acceptance passed 3 tests / 42 assertions. The tracker publication does not change
  application resources. Physical-phone and real-provider acceptance remain separate.
