import { foldkit } from '@foldkit/vite-plugin'
import { defineConfig } from 'vite'
import { zyzz } from 'zyzz/vite'

export default defineConfig({
  // The bundle budget reads which chunks the document loads; public/.assetsignore keeps it unpublished.
  environments: { client: { build: { manifest: true } } },
  // CSS browser baseline, made explicit: zyzz requires native light-dark() and emits CSS
  // nesting, so older browsers drop nested state rules (hover, active, user-invalid).
  build: { cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'] },
  // zyzz compiles styles before Foldkit's plugin sees the modules.
  plugins: [
    zyzz(),
    foldkit({ ssr: { serverEntry: '/src/entry.server.ts', clientEntry: '/src/entry.ts', build: true } }),
  ],
})
