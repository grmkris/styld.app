import { OAuthScope } from '@yielded/auth'

/** One scope for the whole connection, as in the owner's other apps; tool annotations mark
 * read-only and destructive calls. */
export const McpScope = OAuthScope.make('styld')

/** Hosted MCP clients that publish a client metadata document, matched exactly (copied from the
 * owner's myapps CIMD policy). Every other client registers dynamically. */
export const hostedClientMetadata: ReadonlySet<string> = new Set([
  'https://claude.ai/oauth/mcp-oauth-client-metadata',
  'https://chatgpt.com/oauth/client.json',
  'https://chatgpt.com/oauth/codex/client.json',
  'https://vscode.dev/oauth/client-metadata.json',
])

const isLoopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)

/** An exact redirect URI a public client may register: https anywhere, or http on loopback for
 * desktop clients. Custom schemes and fragments are refused. */
export const redirectUriAllowed = (value: string): boolean => {
  if (!URL.canParse(value) || value.length > 512) return false
  const url = new URL(value)
  return url.hash === '' && (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url)))
}

/** RFC 9728 challenge: where the protected resource's metadata is and which scope to ask for.
 * Clients re-authenticate only when told the token is invalid. */
export const challenge = (resourceMetadata: string, error?: 'invalid_token' | 'insufficient_scope') =>
  `Bearer resource_metadata="${resourceMetadata}", scope="${McpScope}"${error === undefined ? '' : `, error="${error}"`}`
