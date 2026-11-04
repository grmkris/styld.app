import { expect, test } from 'vitest'
import { channelOf, newestFor } from './outdated.ts'

test('a beta pin moves to the newest beta even when latest names an older one', () => {
  expect(newestFor('0.1.0-beta.47', ['0.1.0-beta.1', '0.1.0-beta.47', '0.1.0-beta.48', '0.1.0-beta.9'])).toBe(
    '0.1.0-beta.48',
  )
})

test('numeric prerelease identifiers compare as numbers', () => {
  expect(newestFor('2.0.0-beta.85', ['2.0.0-beta.9', '2.0.0-beta.100', '2.0.0-beta.72'])).toBe('2.0.0-beta.100')
})

test('commit-tagged canaries and other channels are not upgrades', () => {
  expect(newestFor('0.170.0', ['0.170.0', '0.171.0-canary.a471adb24d75'])).toBeUndefined()
  expect(newestFor('1.0.0-rc.5', ['1.0.0-rc.5-5935859', '1.0.0-beta.22', '0.45.4'])).toBeUndefined()
  expect(newestFor('7.0.2', ['7.0.2', '7.1.0-beta', '7.1.0-dev.20261103.1'])).toBeUndefined()
})

test('a prerelease pin moves to a stable release that supersedes it', () => {
  expect(newestFor('1.0.0-rc.5', ['1.0.0-rc.6', '1.0.0'])).toBe('1.0.0')
})

test('a stable release is newer than its own prereleases and older than the next version', () => {
  expect(newestFor('1.0.0-rc.5', ['0.45.4', '1.0.0-rc.4'])).toBeUndefined()
  expect(newestFor('0.20.1-ts7.1.0-beta', ['0.20.1-ts7.1.0-beta', '0.21.0-ts7.1.0-beta'])).toBe('0.21.0-ts7.1.0-beta')
})

test('a held pin moves only below its hold', () => {
  const published = ['24.19.2', '24.20.0', '25.0.0-rc.1', '25.9.3', '26.6.6']
  expect(newestFor('24.19.2', published, '25.0.0')).toBe('24.20.0')
  expect(newestFor('24.19.2', published)).toBe('26.6.6')
  expect(newestFor('1.89.0', ['1.89.0', '1.90.0', '1.91.0'], '1.90.0')).toBeUndefined()
})

test('specifiers that are not plain versions have no channel and no upgrade', () => {
  expect(channelOf('^1.2.0')).toBeUndefined()
  expect(newestFor('catalog:', ['1.0.0'])).toBeUndefined()
  expect(channelOf('2.0.0-beta.85')).toBe('beta')
  expect(channelOf('1.4.2')).toBe('')
})
