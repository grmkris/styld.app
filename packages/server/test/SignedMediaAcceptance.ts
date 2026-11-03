import { expect } from 'bun:test'

/** A private picture capability works without a cookie and binds its owner, object, version and expiry. */
export const verifySignedImage = async (origin: string, address: string) => {
  expect(address.startsWith('/cdn/media/')).toBe(true)
  const image = await fetch(new URL(address, origin))
  expect(image.status).toBe(200)
  expect(image.headers.get('content-type')).toBe('image/webp')
  expect(image.headers.get('cache-control')).toContain('private')
  expect(image.headers.get('cache-control')).toContain('immutable')
  expect(image.headers.get('vary') ?? '').not.toContain('Cookie')
  for (const [field, value] of [
    ['a', 'another-account'],
    ['k', 'accounts/another/object'],
    ['v', 'another-version'],
    ['e', '1'],
    ['s', 'invalid'],
  ]) {
    const changed = new URL(address, origin)
    changed.searchParams.set(field ?? '', value ?? '')
    expect((await fetch(changed)).status).toBe(403)
  }
}
