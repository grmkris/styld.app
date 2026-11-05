import { assistantViews } from './apps/AssistantViews.generated.ts'

/** The MCP Apps view every Styld tool with a picture renders into (SEP-1865). Hosts cache a resource by its URI, and a
 * cached view decodes results strictly, so a view older than the server's contract shows nothing at all (ChatGPT, 5
 * November: views-v3 kept its URI when the garment groups changed, and the wardrobe stayed an empty box). The URI
 * therefore carries the bundle's own hash: any rebuilt view is a new resource, and no one has to remember to bump it.
 * @internal Exported for its tests. */
export const viewsUri = `ui://styld/views-${assistantViews.sha256.slice(0, 12)}.html`
const viewsMimeType = 'text/html;profile=mcp-app'

const viewsDescription = 'Shows your Styld wardrobe, boards, pieces, outfits, Gallery photos and try-ons.'

/** No network, no frames: the view receives everything through the host bridge. Every `*_show` tool shares this one
 * resource, so its description is its own: without one ChatGPT copies the first such tool's description onto all. */
const viewsMeta = {
  ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false },
  'openai/widgetDescription': viewsDescription,
}

/** `_meta` for a tool whose result the view shows. */
export const showsView = { ui: { resourceUri: viewsUri } }

export const resources = [
  {
    uri: viewsUri,
    name: 'Styld',
    description: viewsDescription,
    mimeType: viewsMimeType,
    _meta: viewsMeta,
  },
]

/** Any views URI Styld has published. A conversation that listed the tools before a deploy still names the old one. */
const publishedViews = /^ui:\/\/styld\/views-[0-9a-z]+\.html$/

/** `resources/read`: the views' HTML, the current one under whichever views URI was asked for, or nothing for an
 * unknown URI. */
export const readResource = (uri: string) =>
  publishedViews.test(uri)
    ? { contents: [{ uri, mimeType: viewsMimeType, text: assistantViews.html, _meta: viewsMeta }] }
    : undefined
