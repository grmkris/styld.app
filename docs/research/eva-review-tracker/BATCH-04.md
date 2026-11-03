# Eva media batch 04 — 3 November 2026

Status: deployed at `ac535e1`; authenticated media/load acceptance remains open. Not verified.
Baseline: checkout `62258e1`, application build from `15ddaca`.

## Approved sequence

1. T-21: signed delivery for the remaining private media, with loading evidence.
2. T-06 and remaining T-15: preserve filters/return paths and offer rotation.
3. T-01/T-05: foreground/no-garment recognition and a physical-phone check by Kris.
4. T-16: save a board outfit as a Look, then one focused T-10 template.

This receipt covers step 1. The other steps remain planned or partial. No production resources are authorized.

## Implementation

Board images, Gallery photos and garment thumbnails, review detections and generated turn files receive addresses
in their containing API responses. All use the existing HMAC signer and private delivery route; old per-kind
routes are removed. Lists authorize and load rows in bounded batches. The image handler needs no session or D1.
Generated videos stream from R2 with single-range requests, suffix ranges, If-Range and conditional ETags.
Photos still pass through the metadata-stripping Images transform; only generated turn files use raw delivery.

Ordinary MCP answers receive no media addresses. A scoped collector passes already-authorized thumbnail metadata
to the embedded-view renderer, which returns only transformed WebP data URLs under private UI metadata. It makes
no per-thumbnail database lookup. Public media retains its visibility checks.

The current canvas already distinguishes piece cutouts and board photographs by their styles; it has no URL-prefix
blend selector. This was rechecked against the working source rather than applying the older analysis blindly.

## Baseline and acceptance boundaries

The synthetic local workerd/Chromium baseline contains 50 board images, 100 Gallery photos and 30 review detections.
All loaded at 390×844 and 1440×844 without response failures. Before captures are in `evidence/batch-04/`.
The native fixture contains no personal photos and calls no paid providers. One local cold load is diagnostic,
not a production benchmark or evidence that Eva’s F-43 hero delay is resolved.

Baseline elapsed milliseconds (including page load and screenshot-harness work):

| Viewport | Board | Gallery | Review |
| --- | ---: | ---: | ---: |
| 390×844 | 14887 | 8253 | 2747 |
| 1440×844 | 15609 | 7573 | 2641 |

## Local acceptance and review

The consolidated `heavy --wait bun run check` passed: 670 files typechecked with zero findings; static gates,
lint, generated assistant view and bundle budgets green; 777 unit tests in 121 files; 30 native tests with
1,453 assertions. The follow-up screenshot harness passed one test / 17 assertions in 71.52 seconds.
All six loads had no failed image responses or browser page errors. Matching before/after pairs are attached
to T-21 and visually reviewed: board image colour, grid layout and review cards are preserved at both widths.

After elapsed milliseconds, using the same diagnostic harness:

| Viewport | Board | Gallery | Review |
| --- | ---: | ---: | ---: |
| 390×844 | 17842 | 7015 | 3171 |
| 1440×844 | 3309 | 2480 | 1923 |

These single runs include startup, page load and harness work; the mixed results do not establish a production
speedup. The structural result is cookie-free signed delivery without D1 in the media handler.

Review rounds checked (1) protocol and module boundaries, bounded row loading and the generated assistant view;
(2) owner-prefix/HMAC authorization, private caching, transformed user photos, scoped MCP metadata and streamed
range reads; (3) native browser products and all six matching screenshot pairs. No further blocker was found.

T-21 remains ready for review until preview media readback, authenticated load/Workers Logs and expiry-refresh
requirements are accepted. F-43’s hero-picture delay remains independently unverified.

## Preview readback

Release `ac535e105803a92d1290321cb1cb87221ceb813a` deployed on 3 November at 14:27 UTC. The reviewed plan
updated three Workers and two release bindings, with no storage/migration changes. Alchemy reported all three
updates successful. Exact-release smoke passed three tests / 42 assertions. API and SSR release bindings match;
only the edge exposes workers.dev, and no preview custom domains are attached. Deployment IDs:
edge `0c266c3b-bff3-4afb-81f9-71a7a6ffc6cc`, SSR `7ddd2560-4efa-46b7-b926-993b876ec0d0`,
API `49efd079-16c5-4169-881a-be471376547e` (each at 100%).

Existing browser auth state returned 401 on all four media inventory reads. This is an authentication coverage
gap, not a media failure. Authenticated preview reads of every kind, load/Workers Logs and expiry-refresh
acceptance remain open. No paid providers or production resources were used.
