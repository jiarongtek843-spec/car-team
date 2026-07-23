import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // @ts-expect-error — `test` is Vitest's config extension. Using `defineConfig` from
  // 'vitest/config' instead would type-check this correctly, but it pulls in vitest's
  // own bundled (and version-skewed) copy of Vite's types, which then conflicts with
  // the top-level `vite` package's Plugin type used by `react()` above — a classic
  // "dual package hazard" from two different Vite instances in the dependency tree,
  // not an actual type error. This is the documented workaround.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: false,
  },
})
