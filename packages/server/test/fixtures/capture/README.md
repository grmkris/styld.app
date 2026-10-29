# Capture fixtures

These are synthetic inputs and recorded provider answers for the capture pipeline. None of them is a photo of a real
person or a real wardrobe.

**Images and video**

- `red-tee.png`, `green-shirt.png`, `blue-dress.png`: drawn garments from the owner's Meta hackathon spike
  (`~/code/meta-hackathon/fixtures/provider-comparison`).
- `red-tee-truth.png`: the answer mask that goes with the red tee.
- `rail-frame.jpg`: frame 80 of the spike's Grok-generated ten-garment rail video, at 1280 × 704.
- `rail-ten-640.mp4`: the same video scaled to 640 px wide. The deployed preview test uses it.
- `tiny-rail.mp4`: the spike's 160 × 112, 8 fps, 48-frame H.264 clip.

**Recorded provider answers**

- `sam-video-tiny-rail.sse`: the SAM 3.1 video stream recorded for `tiny-rail.mp4` (spike run `326d45da…`,
  2026-10-28).
- `sam-still-rail.sse`, `sam-still-red-tee.sse`: SAM 3.1 still streams recorded from a Cloudflare Worker on
  2026-10-29, with the prompts "clothing" and "t-shirt".
- `clef-route-*.json`: the Clef-flash answers from the same probe.
