/**
 * Preview acceptance for captures with the real providers, run by hand against the deployed preview
 * (each run costs a few cents of Meta and Workers AI):
 *
 *   STYLD_PREVIEW_URL=https://… STYLD_PREVIEW_EMAIL=… bun tools/preview-capture.ts
 *
 * Signs in on the real login page. The code goes to the inbox; write it to `STYLD_CODE_FILE`
 * (default `/tmp/styld-preview-code`) and the run continues. The session is kept in
 * `STYLD_PREVIEW_STATE` (default `/tmp/styld-preview-state.json`, mode 600) for later runs. Then:
 * one garment comes back as a transparent cut-out with suggestions and is kept as a piece; the rail
 * frame splits into at least eight cut-outs. Prints a summary without cookies, codes or addresses.
 */
import { existsSync } from 'node:fs'
import { chmod, readFile, rm } from 'node:fs/promises'
import { type APIRequestContext, type BrowserContext, chromium } from 'playwright'
import { Schema } from 'effect'
import { CaptureCreated, Piece, Reviewed, Tray, Upload } from '../packages/protocol/src/index.ts'
import { decodePng } from '../packages/server/src/capture/Pixels.ts'
import { csrf } from '../packages/auth/src/config.ts'

const origin = process.env['STYLD_PREVIEW_URL'] ?? ''
const email = process.env['STYLD_PREVIEW_EMAIL'] ?? ''
const codeFile = process.env['STYLD_CODE_FILE'] ?? '/tmp/styld-preview-code'
const stateFile = process.env['STYLD_PREVIEW_STATE'] ?? '/tmp/styld-preview-state.json'
if (origin === '' || email === '') throw new Error('Set STYLD_PREVIEW_URL and STYLD_PREVIEW_EMAIL')

const fixture = (name: string) => readFile(new URL(`../packages/server/test/fixtures/capture/${name}`, import.meta.url))
const headers = { origin, [csrf.header]: csrf.value }

/** The code the operator wrote down, once it is there. */
const awaitCode = async () => {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const code = /\b(\d{6})\b/.exec(await readFile(codeFile, 'utf8').catch(() => ''))?.[1]
    if (code !== undefined) {
      await rm(codeFile, { force: true })
      return code
    }
    await Bun.sleep(500)
  }
  throw new Error('no code arrived')
}

const signIn = async (context: BrowserContext) => {
  if ((await context.request.get(`${origin}/api/pieces`)).status() === 200) return
  await rm(codeFile, { force: true })
  const page = await context.newPage()
  await page.goto(`${origin}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByRole('heading', { name: 'Check your email' }).waitFor({ state: 'visible' })
  console.log(`code requested; write it to ${codeFile}`)
  await page.getByLabel('Enter verification code').fill(await awaitCode())
  await page.getByRole('button', { name: 'Verify code' }).click()
  await page.waitForURL(`${origin}/account`)
  await context.storageState({ path: stateFile })
  await chmod(stateFile, 0o600)
  await page.close()
}

/** Upload a photo, make it a capture, and wait for the queue to process it. */
const captured = async (request: APIRequestContext, name: string, contentType: string) => {
  const bytes = await fixture(name)
  const upload = await request.post(`${origin}/api/uploads`, {
    headers,
    data: { operationId: `preview-${crypto.randomUUID()}`, contentType, bytes: bytes.byteLength },
  })
  const { uploadId, path } = Schema.decodeUnknownSync(Upload)(await upload.json())
  const put = await request.put(`${origin}${path}`, { headers: { 'content-type': contentType }, data: bytes })
  if (put.status() !== 204) throw new Error(`upload of ${name} answered ${put.status()}`)
  const started = Date.now()
  const created = await request.post(`${origin}/api/captures`, {
    headers,
    data: { operationId: `preview-${crypto.randomUUID()}`, uploadId, source: 'picker' },
  })
  const { captureId } = Schema.decodeUnknownSync(CaptureCreated)(await created.json())
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const tray = Schema.decodeUnknownSync(Tray)(await (await request.get(`${origin}/api/captures/tray`)).json())
    const capture = tray.captures.find(({ id }) => id === captureId)
    if (capture !== undefined && capture.status !== 'processing')
      return { capture, seconds: (Date.now() - started) / 1000, remaining: tray.allowance.remaining }
    await Bun.sleep(1000)
  }
  throw new Error(`${name} is still processing`)
}

/** The share of a cut-out's pixels that are fully transparent. */
const transparentShare = async (request: APIRequestContext, detectionId: string) => {
  const response = await request.get(`${origin}/cdn/detections/${detectionId}/cutout`)
  const picture = decodePng(new Uint8Array(await response.body()))
  let clear = 0
  for (let at = 3; at < picture.data.length; at += 4) if (picture.data[at] === 0) clear += 1
  return { contentType: response.headers()['content-type'], share: clear / (picture.width * picture.height) }
}

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext(existsSync(stateFile) ? { storageState: stateFile } : {})
  await signIn(context)
  const request = context.request

  const single = await captured(request, 'red-tee.png', 'image/png')
  const [first] = single.capture.detections
  if (first === undefined || !first.hasCutout) throw new Error(`one garment found nothing: ${single.capture.status}`)
  const cutout = await transparentShare(request, first.id)
  const kept = await request.post(`${origin}/api/captures/review`, {
    headers,
    data: {
      operationId: `preview-${crypto.randomUUID()}`,
      keep: [{ detectionId: first.id, type: first.suggestion.type ?? 'tops' }],
      discard: single.capture.detections.slice(1).map(({ id }) => id),
    },
  })
  const { pieceIds } = Schema.decodeUnknownSync(Reviewed)(await kept.json())
  const piece = Schema.decodeUnknownSync(Piece)(await (await request.get(`${origin}/api/pieces/${pieceIds[0]}`)).json())
  const thumb = await request.get(`${origin}/cdn/pieces/${pieceIds[0]}/thumb`)

  const rail = await captured(request, 'rail-frame.jpg', 'image/jpeg')
  console.log(
    JSON.stringify(
      {
        single: {
          status: single.capture.status,
          seconds: single.seconds,
          detections: single.capture.detections.length,
          suggestion: first.suggestion,
          cutout,
          piece: piece.status,
          thumb: thumb.status(),
        },
        rail: {
          status: rail.capture.status,
          seconds: rail.seconds,
          detections: rail.capture.detections.length,
          withCutout: rail.capture.detections.filter(({ hasCutout }) => hasCutout).length,
          types: rail.capture.detections.map(({ suggestion }) => suggestion.type),
        },
        remaining: rail.remaining,
      },
      null,
      2,
    ),
  )
  if (cutout.share < 0.1 || rail.capture.detections.length < 8) process.exitCode = 1
} finally {
  await browser.close()
}
