# Eva navigation batch 05 — 3 November 2026

Status: ready for review. T-06 is not verified.
Baseline: application build `ac535e1`, with synthetic local-only navigation fixtures.

## Behaviour

Wardrobe group/type, colours, season, occasion and brand live in URL query parameters. Chip changes replace
the current history entry. Piece links include the filtered parent and selected-piece anchor, which is also
recorded on the source entry before opening the piece. Both visible Back and browser Back can restore that
list and item; a cold list waits for its pieces before scrolling to the anchor.

Gallery's review-tray link carries the originating photo. The review return link and successful save use that
photo when supplied. Return parameters accept only a local route of the expected parent kind, preventing an
external destination or unrelated page from becoming the return link.

The old board collage address replaces itself with the single board address. Opening and closing board settings
remain model state and add no history entries. No migration, API operation or provider call changes.

## Baseline

At both 390×844 and 1440×844, the unchanged application returned from a selected Low shoes piece to
`/wardrobe`, with the 20 synthetic dresses visible again. Returning from Gallery's review tray also went to
`/wardrobe` and lost the originating photo. Four before captures are under `evidence/batch-05/`.

The baseline capture passed one test / five assertions. A planted fault dropping the initial URL filters made
the new Scene regression fail; that fault was restored before final validation.

## Investigation notebook

The first complete gate passed all static/build checks and 780 unit tests. Thirty existing native tests passed;
the new navigation journey stopped on its desktop browser-Back visibility assertion. The URL filters survived.
An instrumented repro against the same built local application recorded the selected tile at `top = -0.484375`,
`bottom = 185.6875`, with `scrollY = 831`, for both visible and browser Back. Six samples per return were stable.
The item was in view: integer browser scroll offsets and fractional CSS grid tracks invalidated a strict `top >= 0`
assertion. The assertion now allows one CSS pixel of rounding and requires the whole tile to be in the viewport.
No application change or timeout increase was needed for that result.

A subsequent full-gate attempt stopped at formatting in another session's unfinished provider migration. Those
edits were preserved. Final validation runs in an isolated detached checkout of `b8bb428` plus the explicit T-06
patch and fixtures, so the navigation release excludes that unrelated work.

## Acceptance boundaries

The native browser journey checks both viewport widths through the built website and real local workerd edge:
filter history length, reload, visible and browser Back, selected-item visibility, Gallery's review return,
canonical board address, settings history length and browser Back to the board list. Test accounts and pictures
are synthetic; no personal wardrobe or paid providers are used.

The focused native journey passed after the one-pixel rounding correction: 1 test / 17 assertions, with both
390×844 and 1440×844 journeys. The repository's static gates and unit suite passed in the isolated snapshot
(678 files / zero type findings, 780 unit tests). A concurrent full native suite encountered the existing local
SQLite `SQLITE_BUSY_SNAPSHOT` contention and unrelated service startup failures; that run is not treated as
T-06 acceptance. Preview smoke, an authenticated preview navigation walk and Kris's physical Android Back
check remain open.

The four matching screenshots are attached to T-06 in the shared tracker. The before captures show the old
unfiltered wardrobe return and Gallery return to Wardrobe. The after captures show the selected filtered piece
and the originating Gallery photo at both widths.

These are emulated Chromium viewports, not physical Android hardware. Preview release smoke proves deployed
release and hydration, not a signed-in navigation walk. Android gesture/hardware Back remains for Kris's phone
check, alongside the later camera acceptance.
