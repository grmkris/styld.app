# Eva review batch 01 — 3 November 2026

Application release: `c05071e0351cef5bb74caf249eea808775042842`.
Shared tracker: https://styld-review-07c26b483ccc.pages.dev
Preview: https://styldappv2-styldedge-preview-le7xsbk4pgfxkm7o.kristjan-grm11775.workers.dev

## Delivered scope

- **T-13 verified:** Ask opens chat directly with a sparkle icon, Back returns to Wardrobe, and returning through
  Ask resumes the latest saved chat. Keyword search remains a separate, explicitly labelled Wardrobe action.
  This is the recorded interpretation of removing the intermediate search step; search itself was retained.
- **T-15 partial:** compact Add to board beside the title; back-photo actions/cost above Name in Edit; optional
  Name with an example; explicit Category; Delete inside Edit with confirmation, draft preservation on Cancel,
  and a save-in-progress guard. Rotation/upside-down cutouts remain open. Dense metadata and long titles need
  Eva's phone review before claiming that every detail state always fits above the fold.
- **T-05 partial:** guided cameras precede library upload; the taken count finishes capture and the lower Finish
  action is prominent. Countdown, extra flipping time and no-garment/face recognition changes remain open.
  The operating system still controls which options its file picker offers.

Commits: `270f616` (Ask), `bcf376e` (piece editing), `190aa50` (camera controls), `c05071e` (camera-only Finish copy).
Original finding text and ticket bodies are unchanged. Explicit checklists were added to these three tickets.
Finding statuses are independent: F-10, F-23, F-39, F-44 and F-47 are verified at the recorded evidence levels;
F-42 awaits denser metadata/phone review and F-50 remains partial.

## Validation and review

- One completed full batch gate: `heavy --wait bun run check`, exit 0 on `c05071e`. All format, vendor, translation,
  architecture, style, suppression, canary, type, lint, unused, duplication, build and budget checks passed;
  755 unit tests in 119 files; 29 native tests with 1,276 assertions. Effect/TS: 659 files, zero findings.
- The earlier gate attempt was stopped during its unit phase when review found that `capture.done` also labels
  the review tray. The final commit uses a camera-specific Finish key and preserves the review tray's Done.
- Focused scene/story checks cover direct navigation, the board picker, back controls in Edit, deletion
  confirmation/cancel, draft retention and the pending-save guard. The full native Gallery journey covers
  direct Ask navigation and chat resumption plus saving through the compact board action. Native capture
  acceptance finishes through the count and confirms the front/back pair in the review tray.
- Architecture/tooling review: views remain pure; existing routes, Commands and board/camera lifecycles are
  reused. No server adapters or new backend APIs were added. English and Slovenian catalogs were updated via
  x18n; generated catalogs and icons pass their gates.
- Security/lifecycle review: delete still requires confirmation, cannot start while saving, and cancel retains
  the draft. Camera finishing uses the existing cancellation/unmount path. No real wardrobe data or paid
  provider calls were used in screenshot capture or native acceptance.
- Product review: all nine matching pairs were visually inspected at phone and desktop widths. Existing native
  browser journeys passed the modified controls. Physical phones, dense metadata and live recognition remain
  separate acceptance boundaries.

## Before and after evidence

`evidence/batch-01/` contains nine pairs (18 PNGs): Ask entry, piece detail, piece edit and Add clothes at
390×844 and 1440×844; camera finishing at 390×844. These are full-page screenshots, so document heights may
change while the viewport stays fixed. Before uses `c5d6f52`; after uses the final `c05071e` build.

Captures run the real built website through local workerd with a synthetic account, `red-tee.png` from the
native fixtures and Chromium's synthetic camera stream. The camera stream moves between frames. They are
browser viewport evidence, not physical-device or authenticated-preview screenshots. Transition settling was
allowed before each capture. The isolated capture harness passed (1 test, 5 setup assertions).

The tracker now renders pairs inside their tickets, preserves full-size image links, and refuses `verified`
tickets without pairs. It checks image existence, PNG signatures and matching viewport widths/minimum heights.
Negative fixtures for no comparison, missing image and mismatched viewport were correctly refused.
Local Chromium checked all 18 new images, 320/390/1440px layouts, deep links, search/reset and no-JavaScript
comparison reading with zero browser errors. Public readback is recorded in `VALIDATION.md` after publication.

## Deployment evidence

Alchemy's plan and apply updated three preview Workers and two release bindings. Storage, queues and Durable
Object namespaces were unchanged. Deployment completed at 04:42 UTC:

| Worker | Deployment ID | Public access |
| --- | --- | --- |
| Edge | `1bbd071b-826e-4bda-a0e3-2a1d78de0c37` | workers.dev enabled |
| SSR | `f687a6fd-3389-4e91-bd08-65a45b4385ee` | workers.dev and preview URLs disabled |
| API | `ea7695d7-dc27-4058-ae21-2cc1c74fc330` | workers.dev and preview URLs disabled |

Each deployment serves one version at 100%. No custom domains are attached. API release binding and health
readback match `c05071e0351cef5bb74caf249eea808775042842`.

`STYLD_PREVIEW_URL=<above> STYLD_EXPECTED_RELEASE=c05071e0351cef5bb74caf249eea808775042842 heavy --wait bun test
tools/preview.native.test.ts` exited 0: 3 tests, 42 assertions. This covers the release, hydration, assets,
API/auth/CSRF and MCP smoke contracts; signed-in product interactions above were exercised in native fixtures.
Deployment bundle budgets passed: initial browser 349,192 gzip bytes; all browser 613,293; SSR 2,036,836 source bytes.

No v1, production DNS, mail or provider resource changes were made. Telegram progress was sent to the owner as requested.
