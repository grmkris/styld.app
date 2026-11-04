import type { KnipConfig } from 'knip'

export default {
  workspaces: {
    '.': {
      // The gates are entries through package.json's scripts. Scripts an operator runs by hand are listed one by one,
      // so a script nothing runs is reported instead of hiding behind a glob.
      entry: [
        'alchemy.run.ts!',
        'tools/ai-usage-report.ts',
        'tools/preview-capture.ts',
        'tools/provider-live.ts',
        'tools/retype-pieces.ts',
        'tools/import-v1/{Import,Export}.ts',
        'tools/**/*.test.ts',
        '*.config.ts',
      ],
      project: ['tools/**/*.ts', '*.ts'],
      // effect-tsrs embeds the plugin named by tsconfig; it is not a JS dependency. tools/typecheck.ts and the canaries
      // run the effect-tsrs binary by its path.
      ignoreDependencies: ['@effect/language-service', '@yielded/effect-tsrs'],
    },
    'apps/web': {
      // The zyzz Vite plugin discovers GlobalStyles.ts; nothing imports it.
      entry: [
        'src/entry.ts!',
        'src/entry.server.ts!',
        'src/GlobalStyles.ts!',
        'src/assistant/entry.ts!',
        'vite.assistant.config.ts',
        'test/**/*.test.ts',
      ],
      project: ['src/**/*.ts!', 'test/**/*.ts'],
      // A Foldkit page's Commands, Messages and union constructors are used by its own update and are the surface its
      // Story and Scene tests drive (FOLDKIT.md › Testing; Foldkit's own examples export them the same way), so an
      // export the module itself uses is not reported as test-only; one nothing uses still is. The website only: the
      // packages keep full unused-export detection.
      ignoreExportsUsedInFile: true,
    },
    ...Object.fromEntries(
      ['auth', 'domain', 'observability'].map((name) => [
        `packages/${name}`,
        { project: ['src/**/*.ts!', 'test/**/*.ts'] },
      ]),
    ),
    // The API Worker and the stack's resources are the package's exports; the edge Worker and the Thread Workers (the
    // native suite's over its fake model) are a stack's `main` by path. An export only a unit test or the native fakes
    // use is tagged `@internal`, which production mode allows.
    'packages/server': {
      entry: ['src/EdgeWorker.ts!', 'src/stylist/ThreadWorker.ts!', 'test/StylistThreadWorker.ts', 'test/**/*.test.ts'],
      project: ['src/**/*.ts!', 'test/**/*.ts'],
    },
    'packages/db': { project: ['src/**/*.ts!'] },
    'packages/imaging': { project: ['src/**/*.ts!'] },
    'packages/i18n': { project: ['src/**/*.ts!'] },
  },
  // Vendored source: the anti-slop rules and the read-only repos/ snapshots, both verified by tools/vendored.ts.
  ignore: ['tools/oxlint/anti-slop/**', 'repos/**'],
} satisfies KnipConfig
