import { assistantViews } from './apps/AssistantViews.generated.ts'

/** The MCP Apps view every Styld tool with a picture renders into (SEP-1865). The version in the URI
 * changes when a view's contract changes, because hosts cache resources by URI.
 * @internal Exported for its tests. */
export const viewsUri = 'ui://styld/views-v3.html'
const viewsMimeType = 'text/html;profile=mcp-app'

/** No network, no frames: the view receives everything through the host bridge. */
const viewsMeta = { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } }

/** `_meta` for a tool whose result the view shows. */
export const showsView = { ui: { resourceUri: viewsUri } }

export const resources = [
  {
    uri: viewsUri,
    name: 'Styld',
    description: 'Shows your Styld wardrobe, boards, pieces, outfits, Gallery photos and try-ons.',
    mimeType: viewsMimeType,
    _meta: viewsMeta,
  },
]

/** `resources/read`: the views' HTML, or nothing for an unknown URI. */
export const readResource = (uri: string) =>
  uri === viewsUri
    ? { contents: [{ uri, mimeType: viewsMimeType, text: assistantViews.html, _meta: viewsMeta }] }
    : undefined
