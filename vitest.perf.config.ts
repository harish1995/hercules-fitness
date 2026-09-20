import { defineConfig } from 'vitest/config';

// Read-cost measurement on a 10k+ member dataset (US-8.3a). Needs the Firestore emulator and takes a couple of minutes to seed:
//   npm run test:perf   (wraps `firebase emulators:exec --only firestore ...`)
// It is deliberately not part of `npm test` or `npm run test:rules`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/perf/**/*.test.ts'],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
});
