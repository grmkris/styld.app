/** A byte stream read chunk by chunk. The Worker runtime's streams and the DOM lib's both fit, so code
 * that only reads needs no cast between the two type worlds the server package compiles against. */
export interface ByteStream {
  getReader(): { read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array | undefined }> }
}

/** Every chunk of a stream, joined. */
export const collect = async (stream: ByteStream) => {
  const chunks: Array<Uint8Array> = []
  const reader = stream.getReader()
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
    if (chunk.value !== undefined) chunks.push(chunk.value)
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.byteLength
  }
  return joined
}

/** Feed a stream's chunks into a writer, then close it. */
export const pump = async (
  stream: ByteStream,
  writer: { write(chunk: Uint8Array): Promise<void>; close(): Promise<void> },
) => {
  const reader = stream.getReader()
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
    if (chunk.value !== undefined) await writer.write(chunk.value)
  await writer.close()
}
