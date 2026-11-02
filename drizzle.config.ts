import { defineConfig } from 'drizzle-kit'

// One baseline migration (C5) from the tables of `@styld/db`, one file per owning module, and Yielded Auth's in
// `@styld/auth/storage`.
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
]

export default defineConfig({
  dialect: 'sqlite',
  schema: [...modules.map((name) => `./packages/db/src/${name}.ts`), './packages/auth/src/storage.ts'],
  out: './packages/db/migrations',
  verbose: true,
})
