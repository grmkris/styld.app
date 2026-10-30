/**
 * Cut-out lab: SAM masks and the stills they belong to, cut out stepped (scaled by nearest pixel, as before
 * `Matte.ts`) and refined (`Matte.ts`), side by side, so edge changes are judged on real footage. No provider
 * is called. Run by hand:
 *
 *   bun tools/cutout-lab.ts <out-dir> <part-dir>...
 *
 * A part folder holds one `masks*.json` — `{ frameSize: { width, height }, found: [{ track, frame, bounds,
 * raster }] }`, the raster base64, one byte a pixel — and `stills/NN.png`, the still a second the browser
 * sends: still NN shows frame 4×NN of a 4-frames-a-second clip. Writes a PNG pair per garment and an
 * `index.html` beside them; prints what each refinement cost.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Schema } from 'effect'
import { refinedCutOut } from '../packages/server/src/capture/Matte.ts'
import { cutOut, decodePng, encodePng, fitMask } from '../packages/server/src/capture/Pixels.ts'

const [out, ...parts] = process.argv.slice(2)
if (out === undefined || parts.length === 0) throw new Error('Usage: bun tools/cutout-lab.ts <out-dir> <part-dir>...')
await mkdir(out, { recursive: true })

const Saved = Schema.fromJsonString(
  Schema.Struct({
    frameSize: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
    found: Schema.Array(
      Schema.Struct({
        track: Schema.String,
        frame: Schema.Number,
        bounds: Schema.Struct({ left: Schema.Number, top: Schema.Number, right: Schema.Number, bottom: Schema.Number }),
        raster: Schema.String,
      }),
    ),
  }),
)
type Found = (typeof Saved.Type)['found'][number]

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))

const rows: Array<string> = []
const timings: Array<number> = []
for (const part of parts) {
  const name = part.replace(/\/+$/, '').split('/').slice(-2).join('-')
  const masksFile = (await readdir(part)).find((file) => file.startsWith('masks') && file.endsWith('.json'))
  if (masksFile === undefined) continue
  const saved = Schema.decodeUnknownSync(Saved)(await readFile(join(part, masksFile), 'utf8'))
  const stills = new Map(
    (await readdir(join(part, 'stills'))).map((file) => [
      Number(file.replace('.png', '')) * 4,
      join(part, 'stills', file),
    ]),
  )
  // Each garment's largest sighting on a frame that has a still.
  const best = new Map<string, Found & { area: number }>()
  for (const found of saved.found) {
    if (!stills.has(found.frame)) continue
    const area = bytesOf(found.raster).reduce<number>((sum, value) => sum + (value === 0 ? 0 : 1), 0)
    if (area > (best.get(found.track)?.area ?? 0)) best.set(found.track, { ...found, area })
  }
  for (const [track, found] of best) {
    const still = stills.get(found.frame)
    if (still === undefined) continue
    const picture = decodePng(new Uint8Array(await readFile(still)))
    const mask = { bounds: found.bounds, raster: bytesOf(found.raster) }
    const fitted = fitMask(mask, saved.frameSize, picture)
    const started = performance.now()
    const refined = refinedCutOut(picture, mask, saved.frameSize)
    timings.push(performance.now() - started)
    if (refined.piece.width === 0) continue
    const file = `${name}-t${track}`
    await writeFile(join(out, `${file}-stepped.png`), encodePng(cutOut(picture, fitted)))
    await writeFile(join(out, `${file}-refined.png`), encodePng(refined.piece))
    rows.push(
      `<figure><img src="${file}-stepped.png"><img src="${file}-refined.png"><figcaption>${file}</figcaption></figure>`,
    )
  }
}

await writeFile(
  join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Cut-out lab</title><style>
body{font:14px system-ui;margin:16px;background:#fff}figure{display:inline-block;margin:8px}
img{height:240px;margin:2px;background:conic-gradient(#ccc 25%,#eee 0 50%,#ccc 0 75%,#eee 0) 0 0/16px 16px}
</style><p>Left stepped, right refined.</p>${rows.join('\n')}`,
)
const sorted = timings.toSorted((a, b) => a - b)
console.log(
  JSON.stringify({
    garments: rows.length,
    refineMs: { median: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0), max: Math.round(sorted.at(-1) ?? 0) },
    out,
  }),
)
