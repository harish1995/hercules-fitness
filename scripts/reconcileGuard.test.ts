import { describe, expect, it } from 'vitest';
import { assertReconcileTarget, ReconcileRefusedError } from './reconcileGuard';

const CONFIG = {
  VITE_FIREBASE_API_KEY: 'k',
  VITE_FIREBASE_AUTH_DOMAIN: 'p.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'p',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
  VITE_FIREBASE_APP_ID: 'a',
};

describe('assertReconcileTarget (read-only, but deliberate)', () => {
  it('uses the local emulator when FIRESTORE_EMULATOR_HOST is a loopback address', () => {
    expect(assertReconcileTarget({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, [])).toEqual({ kind: 'emulator', host: '127.0.0.1', port: 8080 });
  });

  it('refuses a non-loopback "emulator" host (it would be a real server)', () => {
    expect(() => assertReconcileTarget({ FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }, [])).toThrow(ReconcileRefusedError);
  });

  it('a real project needs the config, an Admin email + password from the environment, and an explicit --yes', () => {
    const env = { ...CONFIG, RECONCILE_EMAIL: 'owner@example.com', RECONCILE_PASSWORD: 'secret' };
    expect(() => assertReconcileTarget(env, [])).toThrow(/--yes/);
    expect(() => assertReconcileTarget({ ...env, RECONCILE_PASSWORD: undefined }, ['--yes'])).toThrow(/RECONCILE_PASSWORD/);
    expect(() => assertReconcileTarget({ ...env, RECONCILE_EMAIL: undefined }, ['--yes'])).toThrow(/RECONCILE_EMAIL/);
    expect(() => assertReconcileTarget({ RECONCILE_EMAIL: 'a@b.co', RECONCILE_PASSWORD: 'x' }, ['--yes'])).toThrow(/Missing: VITE_FIREBASE_API_KEY/);
    const target = assertReconcileTarget(env, ['--yes']);
    expect(target).toMatchObject({ kind: 'project', projectId: 'p', email: 'owner@example.com' });
  });

  it('refuses service-account credentials and a password passed as an argument', () => {
    expect(() => assertReconcileTarget({ GOOGLE_APPLICATION_CREDENTIALS: '/k.json' }, [])).toThrow(/service-account/);
    expect(() => assertReconcileTarget({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, ['--password=hunter2'])).toThrow(/argument/);
    expect(() => assertReconcileTarget({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, ['--password', 'hunter2'])).toThrow(/argument/);
  });

  it('refuses ambiguous emulator settings', () => {
    expect(() => assertReconcileTarget({ ...CONFIG, VITE_USE_EMULATORS: 'true', RECONCILE_EMAIL: 'a@b.co', RECONCILE_PASSWORD: 'x' }, ['--yes'])).toThrow(/VITE_USE_EMULATORS/);
  });

  it('never puts the password in an error message', () => {
    try {
      assertReconcileTarget({ ...CONFIG, RECONCILE_EMAIL: 'owner@example.com', RECONCILE_PASSWORD: 'topsecretpw' }, []);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('topsecretpw');
    }
  });
});
