import type { KnipConfig } from 'knip'

export default {
  workspaces: {
    '.': {
      entry: ['alchemy.run.ts!', 'tools/*.ts', 'tools/**/*.test.ts', '*.config.ts'],
      project: ['tools/**/*.ts', '*.ts'],
      // effect-tsrs embeds the plugin named by tsconfig; it is not a JS dependency.
      ignoreDependencies: ['@effect/language-service'],
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
      ['auth', 'domain', 'observability', 'server'].map((name) => [
        `packages/${name}`,
        { project: ['src/**/*.ts!', 'test/**/*.ts'] },
      ]),
    ),
    'packages/db': { project: ['src/**/*.ts!'] },
    'packages/imaging': { project: ['src/**/*.ts!'] },
    'packages/i18n': { project: ['src/**/*.ts!'] },
  },
  // Vendored source is checked byte-for-byte against its recorded upstream hash.
  // repos/ holds read-only upstream snapshots for agents (tools/vendored-repos.ts).
  ignore: ['tools/oxlint/anti-slop/**', 'repos/**'],
} satisfies KnipConfig
