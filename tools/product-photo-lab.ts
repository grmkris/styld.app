/**
 * Product-photo lab: a cut-out redrawn as a clean product photo by two Workers AI image models, side by side,
 * to decide whether Styld offers a "product photo" for a piece and with which model. Paid: about $0.0012 a
 * picture for FLUX.2 [klein] 4B and $0.009 for FLUX 3 Image Klein, which reads references only from an https
 * link (a data URI is refused, 2026-10-30). Run by hand:
 *
 *   CLOUDFLARE_ACCOUNT_ID=… bun tools/product-photo-lab.ts <out-dir> <cut-out.png>...
 *
 * Reads `CLOUDFLARE_API_TOKEN` and never prints it. Each cut-out is flattened onto a light ground (Klein 4B
 * takes references under 512×512), both models get the same prompt, and the results land in `<out-dir>` with
 * a `results.json` of times and estimated costs.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { decodePng, encodePng, type Rgba } from '../packages/server/src/capture/Pixels.ts'

const [out, ...cutOuts] = process.argv.slice(2)
if (out === undefined || cutOuts.length === 0)
  throw new Error('Usage: bun tools/product-photo-lab.ts <out-dir> <cut-out.png>...')
const account = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? 'bceaeae4788dce3493514fde194b4a7e'
const token = process.env['CLOUDFLARE_API_TOKEN'] ?? ''
await mkdir(out, { recursive: true })

/** One prompt for both models: the same garment, nothing invented beyond what the cut-out hides. */
const prompt = [
  'A clean e-commerce product photo of the exact garment in the reference image,',
  'shown whole and flat from the front as if on an invisible mannequin, centred on a plain light grey background,',
  'soft even studio light. Keep its colour, fabric, print, logos, buttons and shape exactly as in the reference;',
  'complete only the parts the reference hides, matching the rest. No person, no hands, no hanger, no text.',
].join(' ')

/** The cut-out on a light ground, scaled to fit within `edge` px. */
const flattened = (piece: Rgba, edge: number): Rgba => {
  const scale = Math.min(1, edge / Math.max(piece.width, piece.height))
  const width = Math.max(1, Math.round(piece.width * scale))
  const height = Math.max(1, Math.round(piece.height * scale))
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from =
        (Math.min(piece.height - 1, Math.floor(y / scale)) * piece.width +
          Math.min(piece.width - 1, Math.floor(x / scale))) *
        4
      const alpha = (piece.data[from + 3] ?? 0) / 255
      for (let channel = 0; channel < 3; channel++)
        data[(y * width + x) * 4 + channel] = Math.round((piece.data[from + channel] ?? 0) * alpha + 236 * (1 - alpha))
      data[(y * width + x) * 4 + 3] = 255
    }
  return { width, height, data }
}

const Klein4b = Schema.Struct({ result: Schema.Struct({ image: Schema.String }) })
const Flux3 = Schema.Struct({ result: Schema.Struct({ image: Schema.String }) })

/** FLUX.2 [klein] 4B, Cloudflare-hosted: multipart, a reference under 512×512, a base64 image back. */
const klein4b = async (reference: Rgba) => {
  const form = new FormData()
  form.append('prompt', prompt)
  form.append('input_image_0', new Blob([new Uint8Array(encodePng(reference))], { type: 'image/png' }), 'reference.png')
  form.append('width', '1024')
  form.append('height', '1024')
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    },
  )
  if (!response.ok) throw new Error(`klein 4b answered ${response.status}`)
  const { result } = Schema.decodeUnknownSync(Klein4b)(await response.json())
  return Uint8Array.from(atob(result.image), (character) => character.charCodeAt(0))
}

/** FLUX 3 Image Klein, a third-party model through Workers AI: a data-URI reference, an image URL back. */
const flux3 = async (reference: Rgba) => {
  const dataUri = `data:image/png;base64,${Base64.encode(encodePng(reference))}`
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'black-forest-labs/flux-3-image-klein',
      input: { prompt, images: [dataUri], resolution: '1k' },
    }),
  })
  if (!response.ok)
    throw new Error(`flux 3 klein answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const { result } = Schema.decodeUnknownSync(Flux3)(await response.json())
  const image = await fetch(result.image)
  return new Uint8Array(await image.arrayBuffer())
}

const results: Array<Record<string, unknown>> = []
for (const path of cutOuts) {
  const name = basename(path, '.png')
  const piece = decodePng(new Uint8Array(await readFile(path)))
  const row: Record<string, unknown> = { name }
  for (const [model, run, edge, usd] of [
    ['klein-4b', klein4b, 511, 4 * 0.000287 + 0.000059],
    ['flux-3-klein', flux3, 1024, 0.009],
  ] as const) {
    const started = performance.now()
    try {
      const image = await run(flattened(piece, edge))
      await writeFile(join(out, `${name}-${model}`), image)
      row[model] = { seconds: Math.round(performance.now() - started) / 1000, usd }
    } catch (error) {
      row[model] = { failed: String(error).slice(0, 200) }
    }
  }
  results.push(row)
  console.log(JSON.stringify(row))
}
await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 1))
