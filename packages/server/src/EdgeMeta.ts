// Link previews for public pages, at the edge: which pages get one, how to read it from the API Worker, and the tags
// it adds to the page's head. Plain TypeScript, like the rest of the edge.

/** What a preview shows: the API Worker's `PageMeta`. */
export interface PageMeta {
  readonly title: string
  readonly description: string
  readonly image: string | null
}

const previewed = [/^\/@[a-z0-9._]{3,30}$/u, /^\/(?:boards|looks|pieces)\/[A-Za-z0-9_-]{1,40}$/u]

/** Whether a page's address is one with a preview: a profile, a board, a look or a piece. */
export const hasPreview = (path: string): boolean => previewed.some((pattern) => pattern.test(path))

/** A preview the API Worker answered, or undefined for anything else. */
export const decodeMeta = (body: unknown): PageMeta | undefined => {
  if (typeof body !== 'object' || body === null || !('title' in body) || !('description' in body)) return undefined
  if (!('image' in body)) return undefined
  const { title, description, image } = body
  if (typeof title !== 'string' || typeof description !== 'string') return undefined
  if (image !== null && typeof image !== 'string') return undefined
  return { title, description, image }
}

const entities: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Text made safe inside a quoted HTML attribute.
 * @internal Exported for its tests. */
export const escaped = (text: string): string => text.replace(/[&<>"']/gu, (character) => entities[character] ?? '')

/** The head's tags for a preview of the page at `url`: description, Open Graph, Twitter's card and the canonical
 * address. The image is made absolute on the page's own origin. */
export const headTags = (meta: PageMeta, url: string): string => {
  const image = meta.image === null ? undefined : new URL(meta.image, url).href
  return [
    `<meta name="description" content="${escaped(meta.description)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Styld">',
    `<meta property="og:title" content="${escaped(meta.title)}">`,
    `<meta property="og:description" content="${escaped(meta.description)}">`,
    `<meta property="og:url" content="${escaped(url)}">`,
    ...(image === undefined ? [] : [`<meta property="og:image" content="${escaped(image)}">`]),
    `<meta name="twitter:card" content="${image === undefined ? 'summary' : 'summary_large_image'}">`,
    `<link rel="canonical" href="${escaped(url)}">`,
  ].join('')
}
