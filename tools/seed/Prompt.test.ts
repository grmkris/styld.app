import { describe, expect, test } from 'vitest'
import { specOf } from './Fakes.ts'
import { promptDigestOf, promptOf, sizeOf } from './Prompt.ts'

// The words a house garment is generated from: the same spec always the same prompt, one garment alone, nobody and no
// hanger, logo or text, shown the way its kind is photographed, on a ground background removal can find an edge on.

describe('the garment prompt', () => {
  test('is the same for the same spec, so its digest keys the cache', () => {
    expect(promptOf(specOf())).toBe(promptOf(specOf()))
    expect(promptDigestOf(specOf())).toBe(promptDigestOf(specOf()))
    expect(promptDigestOf(specOf({ look: 'white with red stripes' }))).not.toBe(promptDigestOf(specOf()))
  })

  test('asks for one garment alone, as a product photo, with nobody, no hanger, no logo and no text', () => {
    expect(promptOf(specOf())).toMatchInlineSnapshot(`
      "One Breton striped jumper, cotton knit, white with navy horizontal Breton stripes, visible knit texture, alone, as a clean catalogue product photo.
      View: laid flat, seen from directly above. The whole piece is in frame, centred, with clear space on every side.
      Background: plain, flat, seamless mid grey (#9A9A9A), with only a soft contact shadow. No props, no surface texture.
      Light: soft, even studio light from the front; true-to-life colour; the same light and camera height for every piece.
      Never: a person, body parts, a mannequin, a hanger or hook, tags, labels, logos, brand names, text or a watermark.
      Photorealistic. If a detail is unclear, leave it out rather than invent it."
    `)
  })

  test('shows each kind the way it is photographed, and long garments tall', () => {
    expect(promptOf(specOf({ type: 'coats', colours: ['navy'] }))).toContain('invisible ghost mannequin')
    expect(promptOf(specOf({ type: 'trainers', colours: ['white'] }))).toContain('the pair side by side')
    expect(promptOf(specOf({ type: 'bags', colours: ['brown'] }))).toContain('standing upright')
    expect(promptOf(specOf({ type: 'scarves', colours: ['red'] }))).toContain('folded once')
    expect(promptOf(specOf({ type: 'hats', colours: ['grey'] }))).toContain('front three-quarter view')
    expect(sizeOf('coats')).toBe('1024x1536')
    expect(sizeOf('bags')).toBe('1024x1024')
  })

  test('puts pale garments on mid grey and the rest, grey too, on light warm grey', () => {
    expect(promptOf(specOf({ colours: ['beige'] }))).toContain('mid grey (#9A9A9A)')
    expect(promptOf(specOf({ colours: ['navy'] }))).toContain('light warm grey (#ECEAE6)')
    expect(promptOf(specOf({ colours: ['grey'] }))).toContain('light warm grey (#ECEAE6)')
  })
})
