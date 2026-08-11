import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
      formats: ['es'],
    },
    rollupOptions: { external: [/^node:/, /^@prismbinder\//, 'pako', 'jsonc-parser'] },
    target: 'es2022',
    sourcemap: true,
    minify: false,
    emptyOutDir: false,
  },
})
