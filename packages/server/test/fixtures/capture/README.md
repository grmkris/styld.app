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
- `long-rail.mp4`: a 140-second test pattern with a red corner box, H.264 at 320 × 180 and 12 fps, a mono
  AAC tone, flagged as turned 90°. The browser cuts it into five parts and must draw them upright. Made with:

  ```sh
  ffmpeg -f lavfi -i "testsrc2=size=320x180:rate=12:duration=140" -f lavfi -i "sine=frequency=440:duration=140" \
    -vf "drawbox=x=0:y=0:w=40:h=40:color=red:t=fill" -c:v libx264 -preset veryslow -crf 45 -g 24 \
    -pix_fmt yuv420p -c:a aac -b:a 16k -ac 1 -shortest -movflags +faststart plain.mp4
  ffmpeg -display_rotation 90 -i plain.mp4 -c copy -movflags +faststart long-rail.mp4
  ```

**Recorded provider answers**

- `sam-video-tiny-rail.sse`: the SAM 3.1 video stream recorded for `tiny-rail.mp4` (spike run `326d45da…`,
  2026-10-28).
- `sam-still-rail.sse`, `sam-still-red-tee.sse`: SAM 3.1 still streams recorded from a Cloudflare Worker on
  2026-10-29, with the prompts "clothing" and "t-shirt".
- `clef-route-*.json`: the Clef-flash answers from the same probe.
- `muse-edit-red-tee.json`: Meta Muse Image's answer, on 2026-10-30, to the clean-picture prompt with the drawn red tee
  (cut out through `red-tee-truth.png`, on grey) as its reference; the picture is scaled to 240 × 360 to keep it small.
- `muse-green-shirt.png`: Muse's picture of the drawn green shirt on magenta, from the same run, at 320 × 480.
- `clef-judge-red-tee.json`, `clef-judge-dress-fragment.json`: Clef-flash's judgement of the red tee's cut-out and of
  a corner crop of `blue-dress.png`; `clef-compare-red-tee.json`: Clef comparing Muse's red tee with the drawn one.
  Recorded 2026-10-30 with the questions in `Clef.ts`.
- `clef-route-held-person.json`: Clef-flash's answer, on 2026-10-30, for a real photo of someone holding up one
  garment (person-routing spike, `meta-hackathon/research/2026-10-30/styld-person-routing-and-video-merge.md`).
  Only the answer is kept, never the photo; the spike's `personAny` question is stored under `person`, as
  `Clef.ts` asks it.
