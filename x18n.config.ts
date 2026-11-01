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
    // Language names are written in their own language and the brand is never translated. Log events
    // (`Styld.<Area>.<operation> …`) are read by operators in Workers Logs, never shown to people.
    // `noopener noreferrer` is a link's rel attribute, not words anyone reads.
    ignore: [
      'Styld',
      'English',
      'Slovenščina',
      'English (expanded)',
      'English (RTL)',
      '/^Styld\\.[A-Za-z]+/',
      'noopener noreferrer',
    ],
    // Files without user-facing copy: SQL, developer-only defect messages and CSS values.
    // Everything else, including future server-rendered copy such as emails, is checked.
    ignoreByFile: {
      'packages/auth/src/AttemptLimiter.ts': ['/[\\s\\S]*/'],
      'packages/auth/src/EmailPersistence.ts': ['/[\\s\\S]*/'],
      'packages/server/src/AccountLifecycle.ts': ['/[\\s\\S]*/'],
      'packages/server/src/IsolateCache.ts': ['/[\\s\\S]*/'],
      'packages/server/src/StyldWorker.ts': ['/[\\s\\S]*/'],
      // MCP and OAuth protocol text is written for assistants and OAuth clients, in English (MCP has no
      // locale negotiation); the people who connect see only the website's own copy.
      'packages/server/src/mcp/**/*.ts': ['/[\\s\\S]*/'],
      // The contract's errors declare how they read to an assistant (their MCP `guide`), in the same English; the
      // website never shows them and words its refusals from the catalogs.
      'packages/protocol/src/**/*.ts': ['/[\\s\\S]*/'],
      'packages/server/src/OAuth.ts': ['/[\\s\\S]*/'],
      'packages/server/src/OAuthAssertions.ts': ['/[\\s\\S]*/'],
      // A broken invariant of the server's own hold ids, read only in its logs.
      'packages/server/src/usage/Holds.ts': ['/reserved with another amount$/'],
      // A broken invariant of the API's composition, read only in its logs.
      'packages/server/src/SessionAccount.ts': ['/outside the auth middleware$/'],
      // The conditional spend of an upload is SQL.
      'packages/server/src/wardrobe/Store.ts': ['/^CASE WHEN /'],
      // Questions put to the decision model and provider protocol text; no person ever reads them.
      'packages/server/src/capture/Clef.ts': ['/[\\s\\S]*/'],
      'packages/server/src/capture/TurnPrompt.ts': ['/[\\s\\S]*/'],
      'packages/server/src/capture/Veo.ts': ['/[\\s\\S]*/'],
      'packages/server/src/capture/Meta.ts': ['/[\\s\\S]*/'],
      // The prompt an image model draws a clean picture from, and Muse's protocol text.
      'packages/server/src/capture/CleanPrompt.ts': ['/[\\s\\S]*/'],
      'packages/server/src/capture/Muse.ts': ['/[\\s\\S]*/'],
      // The prompts a generated picture is painted from and the mood board planner's instructions.
      'packages/server/src/generation/PaintPrompt.ts': ['/[\\s\\S]*/'],
      'packages/server/src/generation/Planner.ts': ['/[\\s\\S]*/'],
      // SQL fragments discovery orders and filters by.
      'packages/server/src/social/Discovery.ts': ['/json_each/', '/ is null$/'],
      // The capture providers as the Worker builds them (moved out of StyldWorker.ts), with their stand-in's errors.
      'packages/server/src/capture/Live.ts': ['/[\\s\\S]*/'],
      // Styld's instructions and tool descriptions are written for its model, its chats are stored with SQL, and its
      // model speaks the Chat Completions protocol; no person reads any of it. The person reads only the model's reply.
      'packages/server/src/stylist/Prompt.ts': ['/[\\s\\S]*/'],
      'packages/server/src/stylist/Tools.ts': ['/[\\s\\S]*/'],
      'packages/server/src/stylist/StylistObject.ts': ['/[\\s\\S]*/'],
      'packages/server/src/ai/WorkersAiFetch.ts': ['/[\\s\\S]*/'],
      // The questions the outfit engine puts to Clef, and Thinking's instructions to its text model.
      'packages/server/src/outfits/Judge.ts': ['/[\\s\\S]*/'],
      'packages/server/src/outfits/Proposer.ts': ['/[\\s\\S]*/'],
      // The questions the content check puts to Clef and Llama Guard.
      'packages/server/src/safety/Judge.ts': ['/[\\s\\S]*/'],
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
