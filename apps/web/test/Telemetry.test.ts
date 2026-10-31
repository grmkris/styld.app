import { expect, test } from 'vitest'
import { routeName } from '../src/Telemetry.ts'

test('names a page load or navigation by its route, never by the id or handle in it', () => {
  expect(routeName('/')).toBe('/')
  expect(routeName('/boards/bd_xAA4SsaoKuzQ1yDiVVI-Qg')).toBe('/boards/:board')
  expect(routeName('/boards/bd_xAA4SsaoKuzQ1yDiVVI-Qg/collage')).toBe('/boards/:board/collage')
  expect(routeName('/wardrobe/review')).toBe('/wardrobe/review')
  expect(routeName('/wardrobe/pc_f2O6HJtZ3QSigmwKlQvB-w')).toBe('/wardrobe/:piece')
  expect(routeName('/@nika.kovac')).toBe('/@:handle')
  expect(routeName('/ask/stylist')).toBe('/ask/stylist')
  expect(routeName('/no/such/page')).toBe('other')
})
