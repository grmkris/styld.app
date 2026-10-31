import { expect, test } from 'vitest'
import { routeName, routeUrl } from '../src/Telemetry.ts'

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

test('keeps the route name through the URL sanitizer, as the SDK passes it', () => {
  // The SDK names a navigation scrubUrl(routeName(pathname)), and scrubUrl runs this sanitizer.
  expect(routeUrl(routeName('/wardrobe'))).toBe('/wardrobe')
  expect(routeUrl(routeName('/boards/bd_xAA4SsaoKuzQ1yDiVVI-Qg'))).toBe('/boards/:board')
  expect(routeUrl(routeName('/@nika.kovac'))).toBe('/@:handle')
  expect(routeUrl(routeName('/no/such/page'))).toBe('other')
  expect(routeUrl('https://styld.app/boards/bd_xAA4SsaoKuzQ1yDiVVI-Qg?from=feed#top')).toBe(
    'https://styld.app/boards/:board',
  )
  expect(routeUrl('not a url')).toBe('other')
})
