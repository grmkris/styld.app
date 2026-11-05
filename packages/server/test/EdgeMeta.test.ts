import { describe, expect, test } from 'vitest'
import { escapeHtml } from '@styld/protocol/html'
import { decodeMeta, hasPreview, headTags } from '../src/EdgeMeta.ts'

describe('link previews at the edge', () => {
  test.each([
    '/@nika.kovac',
    `/boards/bd_${'a'.repeat(22)}`,
    `/looks/lk_${'a'.repeat(22)}`,
    `/pieces/pc_${'a'.repeat(22)}`,
  ])('previews the public page %s', (path) => expect(hasPreview(path)).toBe(true))
  test.each(['/', '/boards', `/boards/bd_${'a'.repeat(22)}/collage`, '/@x', '/wardrobe/pc_1', '/@Nika'])(
    'leaves %s without a preview',
    (path) => expect(hasPreview(path)).toBe(false),
  )

  test('escapes what people wrote, so a name never closes the attribute or opens a tag', () => {
    expect(escapeHtml(`"><script>alert('x')</script>&`)).toBe(
      '&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;',
    )
    const tags = headTags(
      { title: 'Rain "coats" <on> Styld', description: 'A board on Styld.', image: '/cdn/public/pieces/pc_1/full' },
      'https://styld.test/boards/bd_1',
    )
    expect(tags).toContain('<meta property="og:title" content="Rain &quot;coats&quot; &lt;on&gt; Styld">')
    expect(tags).toContain('<meta property="og:image" content="https://styld.test/cdn/public/pieces/pc_1/full">')
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(tags).toContain('<link rel="canonical" href="https://styld.test/boards/bd_1">')
    expect(tags).not.toContain('<on>')
  })

  test('a preview without a picture is a summary card', () => {
    const tags = headTags({ title: 'Nika', description: 'Boards', image: null }, 'https://styld.test/@nika')
    expect(tags).toContain('content="summary"')
    expect(tags).not.toContain('og:image')
  })

  test('reads only a whole preview', () => {
    expect(decodeMeta({ title: 'T', description: 'D', image: null })).toEqual({
      title: 'T',
      description: 'D',
      image: null,
    })
    expect(decodeMeta({ title: 'T', description: 'D' })).toBeUndefined()
    expect(decodeMeta({ title: 1, description: 'D', image: null })).toBeUndefined()
    expect(decodeMeta('nope')).toBeUndefined()
  })
})
