import { Option } from 'effect'

// What a JPEG says about itself, read from its bytes the same way in the Worker and the browser.

/** The start-of-frame markers that carry a JPEG's size (every SOFn but DHT, JPG and DAC). */
const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/** The width and height a JPEG declares in its start-of-frame segment, or none when the bytes hold no readable frame. */
export const jpegSize = (jpeg: Uint8Array): Option.Option<{ readonly width: number; readonly height: number }> => {
  const view = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength)
  let at = 2
  while (at + 9 <= jpeg.byteLength && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1] ?? 0
    if (startOfFrame.has(marker)) return Option.some({ height: view.getUint16(at + 5), width: view.getUint16(at + 7) })
    // A fill byte, or a segment and its length.
    at += marker === 0xff ? 1 : 2 + view.getUint16(at + 2)
  }
  return Option.none()
}
