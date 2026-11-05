import { describe, expect, test } from 'vitest'
import { escapeHtml } from '../src/index.ts'

describe('escapeHtml', () => {
  test('escapes every character that could end a text node or a quoted attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;',
    )
  })

  test('escapes an ampersand once, so an entity in the text reads as typed', () => {
    expect(escapeHtml('&amp; &lt;')).toBe('&amp;amp; &amp;lt;')
  })

  test('leaves other text alone, accents and emoji included', () => {
    expect(escapeHtml('Črna obleka, 100% bombaž ✨')).toBe('Črna obleka, 100% bombaž ✨')
    expect(escapeHtml('')).toBe('')
  })
})
