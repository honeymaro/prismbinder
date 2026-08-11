import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: { external: [/^node:/, /^@prismbinder\//, 'pako', 'jsonc-parser'] },
    target: 'es2022',
    sourcemap: true,
    minify: false,
    emptyOutDir: false,
  },
})
