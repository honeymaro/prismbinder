import { defineConfig } from '@playwright/test'

/**
 * The app is built with relative asset paths, so these tests drive the real
 * production bundle straight from the filesystem. No dev server, and what is
 * tested is what would ship.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { headless: true },
})
