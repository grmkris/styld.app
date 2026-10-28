import { defineConfig } from '@x18n/core'

/** x18n manages and checks the en/sl catalogs; `@styld/i18n` formats them at runtime.
 * `tools/i18n-check.ts` stays the authority on ICU syntax, arguments and plural forms. */
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'sl'],
  // react-intl supplies ICU message syntax; general supplies hard-string detection.
  presets: ['react-intl', 'general'],
  resources: [{ pattern: 'packages/i18n/catalogs/{locale}.json' }],
  usage: {
    include: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    // The i18n package holds the catalogs as data; the db package names columns, not messages.
    exclude: ['packages/i18n/src/**', 'packages/db/**'],
    calls: [
      { callee: 'format', key: 1 },
      { callee: 'formatRich', key: 1 },
    ],
  },
  extract: {
    autoDetect: true,
    // Language names are written in their own language and the brand is never translated.
    ignore: ['Styld', 'English', 'Slovenščina', 'English (expanded)', 'English (RTL)'],
    // Only views carry user-facing copy: server code holds SQL and protocol strings, and
    // `*.styles.ts`, `GlobalStyles.ts` and `zyzz.config.ts` hold CSS values.
    ignoreByFile: {
      'packages/**': ['/[\\s\\S]*/'],
      'apps/web/src/**/*.styles.ts': ['/[\\s\\S]*/'],
      'apps/web/src/GlobalStyles.ts': ['/[\\s\\S]*/'],
      'apps/web/src/zyzz.config.ts': ['/[\\s\\S]*/'],
    },
  },
  // v1 leaves these onboarding result prompts empty in both locales on purpose.
  ignoreKeys: ['onboardingFlows.*.results.question'],
  checks: {
    // x18n 0.1.2 reads the first word of a Slovenian plural branch as a placeholder.
    'placeholder-mismatch': 'off',
    // Most v1 screens are not ported yet; raise to `error` once parity is reached.
    'unused-key': 'info',
    'hard-string': 'warning',
  },
})
