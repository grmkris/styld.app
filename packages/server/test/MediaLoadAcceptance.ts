import { expect } from 'bun:test'
import { Board, ImageItem, Photos, Tray } from '@styld/protocol'
import { Schema } from 'effect'
import { client, signIn } from './Accounts.ts'
import { mediaLoadAccount, mediaLoadBoard } from './MediaLoadFixture.ts'

/** Bulk-authorized lists supply every private image; the whole load then works with no session cookie. */
export const verifyMediaLoad = async (origin: string, fixtures: string) => {
  expect((await fetch(`${fixtures}/test/identity/media-load`, { method: 'POST' })).status).toBe(204)
  const owner = client(origin, await signIn(origin, mediaLoadAccount))
  const board = Schema.decodeUnknownSync(Board)(await (await owner(`/api/boards/${mediaLoadBoard}`)).json())
  const photos = Schema.decodeUnknownSync(Photos)(await (await owner('/api/photos')).json()).photos
  const captures = Schema.decodeUnknownSync(Tray)(await (await owner('/api/captures/tray')).json()).captures
  const detections = captures.flatMap(({ detections: found }) => found)
  expect(board.items).toHaveLength(50)
  expect(photos).toHaveLength(100)
  expect(detections).toHaveLength(30)
  const addresses = [
    ...board.items.filter(Schema.is(ImageItem)).map((item) => item.image?.full ?? ''),
    ...photos.map((photo) => photo.images?.thumb ?? ''),
    ...detections.map((detection) => detection.images?.cutout ?? ''),
  ]
  // Bursts are deliberately concurrent, as a grid's pictures are. Only signatures authorize these requests.
  for (let start = 0; start < addresses.length; start += 30) {
    const statuses = await Promise.all(
      addresses.slice(start, start + 30).map(async (address) => {
        expect(address.startsWith('/cdn/media/')).toBe(true)
        const response = await fetch(new URL(address, origin))
        await response.arrayBuffer()
        return response.status
      }),
    )
    expect(statuses.every((status) => status === 200)).toBe(true)
  }
}
