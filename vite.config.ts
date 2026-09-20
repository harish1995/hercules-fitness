import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // the Firebase SDK (Auth + Firestore) alone is ~525 kB minified; it is isolated in its own chunk above
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Keep the heavy third-party SDKs in their own long-cacheable chunks.
        manualChunks(id: string) {
          if (id.includes('node_modules/firebase/') || id.includes('node_modules/@firebase/')) return 'firebase';
          if (id.includes('node_modules/@mui/') || id.includes('node_modules/@emotion/')) return 'mui';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Rules tests need the Firestore emulator and run through `npm run test:rules`
    // (see vitest.rules.config.ts); they are deliberately not part of `npm test`.
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.ts', 'scripts/**/*.test.ts'],
    // MUI + Testing Library renders are slow when all test files run in parallel on a busy machine
    testTimeout: 20_000,
    css: false,
    restoreMocks: true,
  },
});
