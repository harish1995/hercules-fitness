import { defineConfig } from 'vitest/config';

// Firestore security-rules tests. Must be run inside the emulator:
//   npm run test:rules   (wraps `firebase emulators:exec --only firestore ...`)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // one shared emulator + clearFirestore(): files must not run concurrently
    fileParallelism: false,
  },
});
