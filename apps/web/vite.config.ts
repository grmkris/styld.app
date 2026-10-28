import { foldkit } from '@foldkit/vite-plugin'
import { defineConfig } from 'vite'
import { zyzz } from 'zyzz/vite'

export default defineConfig({
  // The bundle budget reads which chunks the document loads; public/.assetsignore keeps it unpublished.
  environments: { client: { build: { manifest: true } } },
  // zyzz compiles styles before Foldkit's plugin sees the modules.
  plugins: [
    zyzz(),
    foldkit({ ssr: { serverEntry: '/src/entry.server.ts', clientEntry: '/src/entry.ts', build: true } }),
  ],
})
