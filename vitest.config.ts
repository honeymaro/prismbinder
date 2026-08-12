import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Two projects run overlapping suites.
 *
 * The browser project is a gate, not a nicety: the point of the codec packages
 * is that they run unchanged in a browser, so "works in the browser" has to be
 * something CI proves rather than something we assert. Anything reaching for a
 * Node built-in fails here rather than in a user's tab.
 *
 * `*.node.test.ts` is the escape hatch for suites that need a filesystem - the
 * corpus fidelity tests read a local Prism installation. Those run under Node
 * only; everything else runs in both.
 */
const SHARED = ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts']
const NODE_ONLY = ['packages/*/src/**/*.node.test.ts', 'apps/*/src/**/*.node.test.ts']

const src = (pkg: string): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))

/**
 * Tests import workspace packages by name, so without this they resolve to each
 * package's `dist/` - letting a stale build silently decide what the suite
 * tests. Pointing at source removes the build from the inner loop and removes a
 * whole class of confusing failure.
 */
const alias = {
  '@prismbinder/core': src('core'),
  '@prismbinder/formats': src('formats'),
  '@prismbinder/model': src('model'),
  '@prismbinder/charts': src('charts'),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: SHARED,
          // Corpus suites parse every Prism file on the machine - hundreds of
          // documents - so the default 5s is not a meaningful signal here.
          testTimeout: 120_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'browser',
          include: SHARED,
          exclude: NODE_ONLY,
          browser: {
            enabled: true,
            // Vitest 4 takes a provider factory, not a string
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
