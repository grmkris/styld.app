# Eva camera batch 03 — 3 November 2026

Status: in progress. T-01 and T-05 remain partial; T-21 remains open.
Baseline: checkout `c95185b`, built website from deployed application `021dabe`.

## Bounded scope

Add a large cancellable central 3–2–1 countdown, a fresh photo after that count, dark/uniform-frame rejection,
motion cancellation of stale garment checks/countdowns, and explicit Front/Back pairing. Manual shutter remains
available. Background/worn-clothes extraction and face/no-garment recognition require real-provider acceptance;
this batch alone cannot close those broader tickets.

## Investigation notebook

- Hypothesis: a bright-to-black transition arms stillness, and a uniform black frame settles after three samples.
  `Stillness.ts` has no luminance/variance gate. The baseline capture harness uses a synthetic canvas camera and a
  deterministic positive garment-check response to isolate that client behavior from provider judgement.
- Hypothesis: `shotOf` can reinterpret Back as Front when the provider says front/different garment. This explicitly
  creates a second piece even though the guided step says Back. Keep Back until the person chooses Skip the back;
  never let a model's side guess override that choice.
- A countdown must take the live frame after the count, not save the frame from before it. Moving or covering the
  camera must invalidate both an in-flight check and a pending shutter/countdown token.

- Baseline receipt: `EVA_CAPTURE_PHASE=before heavy --wait bun test ./.artifacts/EvaCameraCapture.native.test.ts`
  passed 1 test / 7 assertions. Both 390×844 and 1440×844 advanced to Back after a room-to-black transition.
  Four baseline PNGs are in `evidence/batch-03/`. The garment-check response is deliberately positive; this proves
  the client guard gap, not the accuracy of the live recognition provider.

## T-21 assessment

Not complete at `c95185b`. Wardrobe piece pictures use the deployed signed-media path; board pictures, Gallery
photos/garments, detections and turns still use per-kind session/database routes. Their migration, video ranges,
expiry recovery and deployed load/Workers Logs checks remain open. F-43's observed slow hero image needs an
authenticated measurement; a signed wardrobe route alone does not prove that exact symptom resolved.

## Evidence and commands

Before/after screenshots, focused regression results, review findings and deployment readback will be recorded
here when available. The source report and original ticket/finding wording remain intact.

## Implementation and local acceptance

- A large central 3–2–1 count runs after a positive garment check. The final timer requests a new live frame;
  it does not reuse the image sent to recognition before the count.
- Mean luminance below 18 or variance below 2 blocks automatic settling. A covered/uniform scene clears its
  pending check/countdown; sufficient movement invalidates stale answers and shutter tokens. Manual capture
  remains available. These thresholds need real-phone assessment, especially with dark clothing.
- Every accepted photo resets the motion watch. The unchanged front cannot arm the next Back photo.
  Back remains the explicit side until taken or skipped, even when recognition calls it a different front.
- `heavy --wait bun run check` exited 0: 664 files / zero type findings, lint green, 21 reviewed suppressions,
  763 unit tests in 120 files, 29 native tests / 1,202 assertions. Bundle budgets passed: initial browser
  349,566 gzip bytes, all browser 613,929, SSR 1,914,796 source bytes.
- `GuidedCameraBrowserAcceptance` runs alongside the existing manual camera journey through Chromium/workerd:
  blocked frames send no garment checks, covering the camera at 2 cancels the count, an unchanged front is not
  re-shot, and the side-confused Back reaches the wardrobe as one piece with its back. Fake providers are used.
- `EVA_CAPTURE_PHASE=after heavy --wait bun test ./.artifacts/EvaCameraCapture.native.test.ts` passed 1 test /
  17 assertions. Both viewports sent two garment checks for their front/back pair and had no page errors.
  Four matching before/after pairs are attached to T-01/T-05 in the tracker; all eight PNGs are in `evidence/batch-03/`.
- Mutation receipt: temporarily removing the dark-frame guard made the covered-camera regression fail with
  three unwanted settles; restoring it passed. The canonical unit runner is Vitest (the full gate supplies
  catalog setup), not direct `bun test` on web Scene files.

## Review rounds

1. Architecture/tooling: camera acquisition and frame sampling stay within the scoped Mount; timers and fresh-frame
   requests remain named Foldkit Commands. Refactored event mapping and transitions to pass complexity limits.
2. Privacy/lifecycle: closing, flipping, skipping, manual capture or scene movement invalidates stale tokens.
   No server auth, provider, database, public-media or deployment-resource behavior changes. Images stay out of logs.
3. Product/browser: visually reviewed the four matched phone/desktop pairs. The black-frame baseline advances to
   Back; the fixed view stays at Front with guidance. The large countdown is readable and leaves controls available.

Preview deployment and exact-release readback remain to record. T-01/T-05 stay partial: no provider claim is made
for faces, no-garment scenes, contour detection or excluding background/worn clothing; the review-card Front/Back
preview is still open. F-49 can be verified after preview readback. T-21 is unchanged and open.
