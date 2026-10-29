import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'
import { CurrentAccount } from '../src/CurrentAccount.ts'
import { instructions, styldTools } from '../src/mcp/StyldTools.ts'
import { callTool, renderTools } from '../src/mcp/Tools.ts'
import type { D1 } from '../src/OAuth.ts'
import { challenge, hostedClientMetadata, redirectUriAllowed } from '../src/mcp/Policy.ts'

const accountRow = { displayName: 'Ana Novak', email: 'ana@example.com' }
const database: D1 = {
  prepare: () => ({
    bind: () => ({
      // SAFETY: the fake database answers only the account_get query -- its row has exactly the displayName and email shape that query selects
      first: <T>() => Promise.resolve(accountRow as T),
      run: () => Promise.resolve({ meta: { changes: 0 } }),
    }),
  }),
}
const tools = styldTools(database, 'https://styld.test')
/** The JSON of a result's first text block. */
const jsonOf = (result: {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>
}): unknown => JSON.parse(result.content[0]?.text ?? 'null')
const call = (name: string, args: unknown) =>
  Effect.runPromise(
    callTool(tools, name, args).pipe(
      Effect.provideService(CurrentAccount, CurrentAccount.of({ accountId: 'acc_1', via: 'assistant' })),
    ),
  )

describe('MCP tools', () => {
  test('lists closed, budgeted tools with noun_verb names', () => {
    const list = renderTools(tools)
    expect(list).toEqual([
      {
        name: 'account_get',
        title: 'Your Styld account',
        description: 'The Styld account this connection acts for: name, email and a link to the account page.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { title: 'Your Styld account', readOnlyHint: true, openWorldHint: false },
      },
    ])
    for (const entry of list) {
      expect(entry.name).toMatch(/^[a-z]+_[a-z]+$/)
      expect(`mcp__styld__${entry.name}`.length).toBeLessThanOrEqual(64)
      expect(entry.description.length).toBeLessThanOrEqual(600)
      expect(JSON.stringify(entry).length).toBeLessThanOrEqual(12 * 1024)
    }
    expect(instructions.split('\n\n')[0]?.length).toBeLessThanOrEqual(512)
  })

  test('answers with the account as text and structured content', async () => {
    const result = await call('account_get', {})
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({
      accountId: 'acc_1',
      displayName: 'Ana Novak',
      email: 'ana@example.com',
      url: 'https://styld.test/account',
    })
    expect(jsonOf(result)).toEqual(result.structuredContent)
  })

  test('refuses unknown tools and unknown arguments without echoing values', async () => {
    const unknown = await call('piece_steal', {})
    expect(unknown.isError).toBe(true)
    expect(jsonOf(unknown)).toMatchObject({ code: 'unknown_tool', retryable: false })
    const extra = await call('account_get', { accountId: 'someone-else-secret' })
    expect(extra.isError).toBe(true)
    const refusal = jsonOf(extra)
    expect(refusal).toMatchObject({ code: 'invalid_arguments', retryable: false })
    expect(JSON.stringify(refusal)).toContain('accountId')
    expect(JSON.stringify(refusal)).not.toContain('someone-else-secret')
  })
})

describe('MCP authorization', () => {
  test.each([
    'https://claude.ai/api/mcp/auth_callback',
    'http://127.0.0.1:33418/callback',
    'http://localhost:6274/oauth',
  ])('lets a public client register the redirect %s', (uri) => expect(redirectUriAllowed(uri)).toBe(true))

  test.each([
    'http://evil.example/callback',
    'cursor://anysphere.cursor-retrieval/oauth',
    'https://ok.example/cb#frag',
    'not a url',
  ])('refuses to register the redirect %s', (uri) => expect(redirectUriAllowed(uri)).toBe(false))

  test('admits client metadata documents only from the hosted clients', () => {
    expect(hostedClientMetadata.has('https://claude.ai/oauth/mcp-oauth-client-metadata')).toBe(true)
    expect(hostedClientMetadata.has('https://claude.ai/oauth/other.json')).toBe(false)
  })

  test('challenges with the resource metadata and the one scope', () => {
    const metadata = 'https://styld.test/.well-known/oauth-protected-resource/mcp'
    expect(challenge(metadata)).toBe(`Bearer resource_metadata="${metadata}", scope="styld"`)
    expect(challenge(metadata, 'invalid_token')).toBe(
      `Bearer resource_metadata="${metadata}", scope="styld", error="invalid_token"`,
    )
  })
})
