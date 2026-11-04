import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Fetch } from '../../packages/server/src/providers/Http.ts'

// Meta's API answers this machine's key only over IPv6: over IPv4 it lists no models and inference answers
// `model_not_found` (checked again on 4 November 2026). Bun's fetch cannot choose the address family, so the seed's
// Meta calls go through `curl -6`. The headers (with the key) and the body go through files in a private temporary
// folder, never the command line, and the folder is removed after each call. A call curl could not finish rejects,
// as `fetch` does, so the provider adapter treats it as an answer that was lost.

const lastStatus = (raw: string) => {
  const blocks = raw.split(/\r?\n\r?\n/u).filter((block) => block.trim().length > 0)
  const lines = (blocks.at(-1) ?? '').split(/\r?\n/u)
  const status = Number(/^HTTP\/[\d.]+ (\d{3})/u.exec(lines[0] ?? '')?.[1] ?? Number.NaN)
  const headers = new Headers()
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  return { status, headers }
}

const bodyBytes = async (body: RequestInit['body']) =>
  body === undefined || body === null ? undefined : new Uint8Array(await new Response(body).arrayBuffer())

/** `fetch` over IPv6 through curl, for Meta's API. */
export const ipv6Fetch: Fetch = async (input, init) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'styld-meta-'))
  try {
    const file = (name: string) => path.join(folder, name)
    const headers = [...new Headers(init.headers).entries()].map(([name, value]) => `${name}: ${value}`)
    await writeFile(file('headers'), headers.join('\n'), { mode: 0o600 })
    const body = await bodyBytes(init.body)
    if (body !== undefined) await writeFile(file('body'), body, { mode: 0o600 })
    const args = ['-6', '-sS', '--max-time', '300', '-X', init.method ?? 'GET', '-H', `@${file('headers')}`]
    const curl = Bun.spawn(
      [
        'curl',
        ...args,
        ...(body === undefined ? [] : ['--data-binary', `@${file('body')}`]),
        '-D',
        file('answer-headers'),
        '-o',
        file('answer'),
        input,
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    )
    init.signal?.addEventListener('abort', () => curl.kill())
    if ((await curl.exited) !== 0) throw new Error(`curl could not finish: ${await new Response(curl.stderr).text()}`)
    const { status, headers: answered } = lastStatus(await readFile(file('answer-headers'), 'utf8'))
    if (!Number.isInteger(status)) throw new Error('curl answered without a status')
    return new Response(await readFile(file('answer')), { status, headers: answered })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}
