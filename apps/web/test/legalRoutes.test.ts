import { describe, expect, test } from 'vitest'
import { AppRoute, privacyRouter, routeFromPathname, routeMeta, termsRouter } from '../src/route.ts'

describe('the legal pages’ addresses', () => {
  test('/privacy and /terms are their own pages, readable signed out, and their links build those addresses', () => {
    expect(routeFromPathname('/privacy')).toEqual(AppRoute.Privacy())
    expect(routeFromPathname('/terms')).toEqual(AppRoute.Terms())
    expect(privacyRouter({})).toBe('/privacy')
    expect(termsRouter({})).toBe('/terms')
    expect(routeMeta(AppRoute.Privacy()).session).toBe('optional')
    expect(routeMeta(AppRoute.Terms()).session).toBe('optional')
  })
})
