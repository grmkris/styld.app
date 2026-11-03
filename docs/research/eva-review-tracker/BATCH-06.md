# Eva rotation follow-up — 3 November 2026

Status: implementation ready for review; native capture and deployed acceptance remain open.

## Scope

T-15's remaining F-08 gap is a durable correction for legacy imported cut-outs that arrive upside down. Pieces now
store a constrained clockwise quarter-turn (`0`, `90`, `180` or `270`). The Edit screen advances the image by 90
degrees and previews the draft immediately; saving sends the orientation through the existing piece update operation.
Owner-only signed media carries the rotation in its capability, and the shared Cloudflare Images transform applies it
for the shown picture, clean picture, back picture and MCP thumbnails. Legacy rows default to zero, so the migration is
backward-compatible for existing pieces and old zero-degree signed addresses.

## Evidence

- Typecheck: 681 files, zero findings.
- Focused browser/server batch: 69 tests passed across piece story/scene, signed media, delivery, import and MCP coverage.
- Schema snapshot and forward migration tests passed.
- Full unit run: 802 tests reached; 801 passed. The only failure was the existing dependency-contract subprocess check,
  where this sandbox rejected `spawnSync bun EPERM`.
- Native browser capture was attempted with the T-06 fixture at 390×844 and 1440×844. The environment refused Alchemy's
  profile chmod and local server listen (`EROFS`/`EPERM`), so no native screenshots or acceptance claim is recorded.

## Remaining acceptance

Capture matching before/after screenshots at both emulated viewports, read the deployed signed image with an authenticated
session, and have Kris check the control and saved orientation on a real phone. Keep this separate from live-provider
recognition acceptance. The code is ready for the next isolated preview deployment once the repository gate can run.
