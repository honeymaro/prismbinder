import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const src = (pkg: string): string =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url))

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built app also opens straight from the
  // filesystem, which is how the smoke tests drive it.
  base: './',
  resolve: {
    // Build from workspace source rather than each package's dist. Otherwise a
    // package that has not been rebuilt silently decides what the app contains,
    // which has already cost us one confusing failure.
    alias: {
      '@prismbinder/core': src('core'),
      '@prismbinder/formats': src('formats'),
      '@prismbinder/model': src('model'),
    },
  },
  build: { target: 'es2022', sourcemap: true },
})
