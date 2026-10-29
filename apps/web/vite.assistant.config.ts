import { foldkit } from '@foldkit/vite-plugin'
import { defineConfig } from 'vite'
import { zyzz } from 'zyzz/vite'

/** The assistant views (`src/assistant`): one IIFE and its CSS, which `tools/assistant-views.ts`
 * inlines into a single HTML file. Hosts render it in a sandboxed frame with no network access. */
export default defineConfig({
  build: {
    cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'],
    lib: {
      entry: 'src/assistant/entry.ts',
      formats: ['iife'],
      name: 'StyldViews',
      fileName: () => 'views.js',
      cssFileName: 'views',
    },
    cssCodeSplit: false,
    emptyOutDir: true,
    copyPublicDir: false,
  },
  plugins: [zyzz(), foldkit({ devToolsMcpPort: false })],
})
