import { describe, expect, it } from 'vitest';
import { assertSeedTarget, isDemoProjectId, SEED_PROJECT_ID, SeedRefusedError } from './seedGuard';

describe('assertSeedTarget (seed may run against the local emulator only)', () => {
  it('defaults to the local emulator', () => {
    expect(assertSeedTarget({})).toEqual({ host: '127.0.0.1', port: 8080, authEmulator: null });
  });

  it('accepts loopback emulator addresses, with an optional Auth emulator', () => {
    expect(assertSeedTarget({ FIRESTORE_EMULATOR_HOST: 'localhost:9000', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toEqual({
      host: 'localhost', port: 9000, authEmulator: { host: '127.0.0.1', port: 9099 },
    });
    expect(assertSeedTarget({ FIRESTORE_EMULATOR_HOST: '[::1]:8080' }).host).toBe('[::1]');
  });

  it.each([
    ['a real Firestore host', { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }],
    ['a remote host', { FIRESTORE_EMULATOR_HOST: '10.0.0.5:8080' }],
    ['a lookalike host', { FIRESTORE_EMULATOR_HOST: 'localhost.evil.com:8080' }],
    ['a missing port', { FIRESTORE_EMULATOR_HOST: 'localhost' }],
    ['a non-numeric port', { FIRESTORE_EMULATOR_HOST: 'localhost:abc' }],
    ['a remote auth emulator', { FIREBASE_AUTH_EMULATOR_HOST: 'auth.example.com:9099' }],
    ['a production NODE_ENV', { NODE_ENV: 'production' }],
    ['service-account credentials in the environment', { GOOGLE_APPLICATION_CREDENTIALS: '/keys/sa.json' }],
  ])('refuses %s', (_label, env) => {
    expect(() => assertSeedTarget(env)).toThrow(SeedRefusedError);
  });
});

describe('the seed is refused against a production project id (US-8.4b)', () => {
  it('the seed project id is a demo-* id', () => {
    expect(isDemoProjectId(SEED_PROJECT_ID)).toBe(true);
  });

  it.each(['hercules-fitness-e58a0', 'my-gym', 'demo', 'demo-', 'Demo-x', 'prod-demo-x', 'demo x', ''])('%j is not a demo project id', (id) => {
    expect(isDemoProjectId(id)).toBe(false);
  });

  it.each(['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT', 'FIREBASE_PROJECT_ID'])(
    'refuses when %s names a real project, even next to a loopback emulator',
    (key) => {
      expect(() => assertSeedTarget({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', [key]: 'hercules-fitness-e58a0' })).toThrow(/not a demo-\* project/);
    },
  );

  it('refuses a real project named inside FIREBASE_CONFIG, and an unparseable FIREBASE_CONFIG', () => {
    expect(() => assertSeedTarget({ FIREBASE_CONFIG: JSON.stringify({ projectId: 'my-gym' }) })).toThrow(SeedRefusedError);
    expect(() => assertSeedTarget({ FIREBASE_CONFIG: '{not json' })).toThrow(SeedRefusedError);
  });

  it('does not look at the web app config: a developer\'s .env.local normally holds the real project and the seed never uses it', () => {
    expect(() => assertSeedTarget({ VITE_FIREBASE_PROJECT_ID: 'hercules-fitness-e58a0', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).not.toThrow();
  });

  it('accepts demo-* ids in every place', () => {
    expect(() =>
      assertSeedTarget({
        GCLOUD_PROJECT: 'demo-hercules-fitness',
        FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-hercules-fitness' }),
      }),
    ).not.toThrow();
  });

  it('the error message names the offending id but no credential', () => {
    try {
      assertSeedTarget({ GCLOUD_PROJECT: 'my-gym', GOOGLE_APPLICATION_CREDENTIALS: undefined });
      throw new Error('should have refused');
    } catch (e) {
      expect((e as Error).message).toContain('my-gym');
    }
  });
});
