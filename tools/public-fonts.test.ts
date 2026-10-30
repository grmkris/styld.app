import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const fonts = `${import.meta.dirname}/../apps/web/public/fonts`
const hashed = /^[a-z-]+\.(?<hash>[0-9a-f]{8})\.woff2$/

test('every self-hosted font is named after its content, so browsers can keep it for good', () => {
  const files = readdirSync(fonts).filter((name) => name.endsWith('.woff2'))
  expect(files.length).toBeGreaterThan(0)
  for (const name of files) {
    const hash = createHash('sha256')
      .update(readFileSync(`${fonts}/${name}`))
      .digest('hex')
      .slice(0, 8)
    // A changed font needs a new name: `public/_headers` serves /fonts/* as immutable.
    expect({ name, hash: hashed.exec(name)?.groups?.['hash'] }).toEqual({ name, hash })
  }
})
