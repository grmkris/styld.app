import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: ['./packages/db/src/schema.ts', './packages/db/src/social.ts', './packages/auth/src/storage.ts'],
  out: './packages/db/migrations',
  verbose: true,
})
