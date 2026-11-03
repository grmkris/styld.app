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
