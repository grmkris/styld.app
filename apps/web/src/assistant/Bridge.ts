import { Option, Predicate, Schema } from 'effect'
import type { Runtime } from 'foldkit'
import { AssistantView, ViewImages } from '@styld/protocol'
import type { ports } from './Views.ts'

/** The MCP Apps host side of a view (`ui/*` JSON-RPC over `postMessage`, SEP-1865): the
 * handshake, tool results in, link requests out. Only the host frame is listened to. */
type Handle = Runtime.EmbedHandle<typeof ports>

const ToolResult = Schema.Struct({
  structuredContent: AssistantView,
  _meta: Schema.optionalKey(Schema.Struct({ 'styld/images': Schema.optionalKey(ViewImages) })),
})
const HostContext = Schema.Struct({ locale: Schema.optionalKey(Schema.String) })
const Initialized = Schema.Struct({ hostContext: Schema.optionalKey(HostContext) })

const decodeResult = Schema.decodeUnknownOption(ToolResult)
const decodeContext = Schema.decodeUnknownOption(HostContext)
const decodeInitialized = Schema.decodeUnknownOption(Initialized)

const languageOf = (locale: string | undefined) => (locale?.toLowerCase().startsWith('sl') === true ? 'sl' : 'en')

export const connectHost = (handle: Handle, host: Window = window.parent) => {
  let nextId = 1
  const answers = new Map<number, (result: unknown) => void>()
  const post = (message: object) => host.postMessage({ jsonrpc: '2.0', ...message }, '*')
  const request = (method: string, params: object, onResult: (result: unknown) => void = () => undefined) => {
    const id = nextId++
    answers.set(id, onResult)
    post({ id, method, params })
  }
  const showContext = (context: unknown) =>
    Option.map(decodeContext(context), ({ locale }) =>
      handle.ports.host.send({ _tag: 'ChangedLanguage', language: languageOf(locale) }),
    )

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== host || !Predicate.isObject(event.data)) return
    const data = event.data
    if (typeof data.id === 'number' && answers.has(data.id)) {
      answers.get(data.id)?.(data.result)
      answers.delete(data.id)
      return
    }
    if (data.method === 'ui/notifications/tool-result')
      Option.map(decodeResult(data.params), ({ structuredContent, _meta: meta }) =>
        handle.ports.host.send({ _tag: 'ShowedResult', view: structuredContent, images: meta?.['styld/images'] ?? {} }),
      )
    if (data.method === 'ui/notifications/host-context-changed') showContext(data.params)
  })

  handle.ports.request.subscribe(({ url }) => request('ui/open-link', { url }))

  request(
    'ui/initialize',
    {
      appInfo: { name: 'Styld', version: '1' },
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
      protocolVersion: '2026-01-26',
    },
    (result) => {
      Option.map(decodeInitialized(result), ({ hostContext }) => showContext(hostContext ?? {}))
      post({ method: 'ui/notifications/initialized', params: {} })
    },
  )
}
