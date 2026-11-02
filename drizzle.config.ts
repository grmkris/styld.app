import { defineConfig } from 'drizzle-kit'

// The migrations (the C5 baseline, then each change since) from the tables of `@styld/db`, one file per owning module,
// and Yielded Auth's in `@styld/auth/storage`.
const modules = [
  'identity',
  'receipts',
  'wardrobe',
  'capture',
  'photos',
  'looks',
  'boards',
  'social',
  'safety',
  'worn',
  'generation',
  'outfits',
  'stylist',
  'usage',
  'imports',
]

export default defineConfig({
  dialect: 'sqlite',
  schema: [...modules.map((name) => `./packages/db/src/${name}.ts`), './packages/auth/src/storage.ts'],
  out: './packages/db/migrations',
  verbose: true,
})
