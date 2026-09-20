/**
 * Argument / environment validation for scripts/reconcile.ts. Pure: takes the environment as data, so it is unit-tested.
 * The script is READ-ONLY, so unlike the seed it may target a real project, but only deliberately: an explicit `--yes`
 * (it is billed per document), the project's web config from the environment, and an Admin email + password from the environment.
 */
import { assertSeedTarget, SeedRefusedError } from './seedGuard';

export class ReconcileRefusedError extends Error {
  constructor(message: string) {
    super(`Reconcile refused: ${message}`);
    this.name = 'ReconcileRefusedError';
  }
}

export interface EmulatorTarget {
  kind: 'emulator';
  host: string;
  port: number;
}
export interface ProjectTarget {
  kind: 'project';
  projectId: string;
  email: string;
  password: string;
  config: { apiKey: string; authDomain: string; projectId: string; messagingSenderId: string; appId: string };
}

const CONFIG_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

export function assertReconcileTarget(env: Record<string, string | undefined>, args: readonly string[]): EmulatorTarget | ProjectTarget {
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new ReconcileRefusedError('GOOGLE_APPLICATION_CREDENTIALS is set. This script never uses service-account credentials; unset it.');
  }
  if (args.some((a) => /^--(password|pass|pwd)(=|$)/i.test(a))) {
    throw new ReconcileRefusedError('never pass a password as an argument; set RECONCILE_PASSWORD in the environment instead.');
  }
  if (env.FIRESTORE_EMULATOR_HOST) {
    try {
      const { host, port } = assertSeedTarget(env);
      return { kind: 'emulator', host, port };
    } catch (e) {
      throw e instanceof SeedRefusedError ? new ReconcileRefusedError(e.message.replace(/^Seed refused: /, '')) : e;
    }
  }
  const missing = CONFIG_KEYS.filter((k) => !env[k]?.trim());
  if (missing.length > 0) {
    throw new ReconcileRefusedError(`no emulator and no project config. Missing: ${missing.join(', ')}. See the README ("Reconcile").`);
  }
  if (env.VITE_USE_EMULATORS === 'true') {
    throw new ReconcileRefusedError('VITE_USE_EMULATORS is true but FIRESTORE_EMULATOR_HOST is not set; set one or the other.');
  }
  if (!args.includes('--yes')) {
    throw new ReconcileRefusedError('this reads EVERY member, membership, payment and counter document of the project (billed reads). Re-run with --yes.');
  }
  const email = env.RECONCILE_EMAIL?.trim();
  const password = env.RECONCILE_PASSWORD;
  if (!email || !password) throw new ReconcileRefusedError('set RECONCILE_EMAIL and RECONCILE_PASSWORD (an ADMIN account of the app) in the environment.');
  const value = (k: (typeof CONFIG_KEYS)[number]) => (env[k] ?? '').trim();
  return {
    kind: 'project',
    projectId: value('VITE_FIREBASE_PROJECT_ID'),
    email,
    password,
    config: {
      apiKey: value('VITE_FIREBASE_API_KEY'),
      authDomain: value('VITE_FIREBASE_AUTH_DOMAIN'),
      projectId: value('VITE_FIREBASE_PROJECT_ID'),
      messagingSenderId: value('VITE_FIREBASE_MESSAGING_SENDER_ID'),
      appId: value('VITE_FIREBASE_APP_ID'),
    },
  };
}
