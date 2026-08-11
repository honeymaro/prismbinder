import { defineConfig } from 'vite'

/**
 * Library build. Declarations are emitted separately by `tsc -b
 * --emitDeclarationOnly` rather than by a Vite plugin: dts plugins call the
 * TypeScript compiler API, and TS 7.0 ships no stable programmatic API, so
 * letting tsc write them itself keeps that whole class of breakage away.
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    // Never inline dependencies into a library bundle
    rollupOptions: { external: [/^node:/, 'pako'] },
    target: 'es2022',
    sourcemap: true,
    minify: false,
    // tsc -b writes the .d.ts files into the same dist/, and Vite would
    // otherwise wipe them on its way in. `pnpm clean` owns removal instead.
    emptyOutDir: false,
  },
})
