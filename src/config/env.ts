import { z } from 'zod';

/** Every key the app cannot start without (Storage is intentionally absent, see .env.example). */
export const REQUIRED_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

export type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

/** Thrown when required configuration is missing or invalid. Carries only key NAMES, never values. */
export class ConfigError extends Error {
  readonly missingKeys: readonly string[];

  constructor(missingKeys: readonly string[], detail?: string) {
    super(detail ?? `Missing or invalid configuration: ${missingKeys.join(', ')}`);
    this.name = 'ConfigError';
    this.missingKeys = missingKeys;
  }
}

const nonEmpty = z.string().trim().min(1);

const envSchema = z.object({
  VITE_FIREBASE_API_KEY: nonEmpty,
  VITE_FIREBASE_AUTH_DOMAIN: nonEmpty,
  VITE_FIREBASE_PROJECT_ID: nonEmpty,
  VITE_FIREBASE_MESSAGING_SENDER_ID: nonEmpty,
  VITE_FIREBASE_APP_ID: nonEmpty,
  VITE_USE_EMULATORS: z.enum(['true', 'false']).optional(),
  VITE_EMULATOR_HOST: z.string().trim().min(1).optional(),
});

export interface AppConfig {
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    messagingSenderId: string;
    appId: string;
  };
  useEmulators: boolean;
  emulatorHost: string;
}

export interface EnvSource {
  [key: string]: unknown;
}

/**
 * Validate the raw `import.meta.env` (injectable for tests). Throws ConfigError naming the
 * offending keys (US-1.8b). `isProduction` refuses emulator mode so a production build can
 * never silently point at localhost.
 */
export function loadConfig(raw: EnvSource, isProduction = false): AppConfig {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new ConfigError(keys);
  }
  const env = parsed.data;
  const useEmulators = env.VITE_USE_EMULATORS === 'true';
  if (useEmulators && isProduction) {
    throw new ConfigError(['VITE_USE_EMULATORS'], 'VITE_USE_EMULATORS must not be true in a production build.');
  }
  return {
    firebase: {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    },
    useEmulators,
    emulatorHost: env.VITE_EMULATOR_HOST ?? '127.0.0.1',
  };
}

/** Non-throwing variant used by the bootstrap (main.tsx) to choose between the app and the error screen. */
export function readConfig(
  raw: EnvSource = import.meta.env,
  isProduction: boolean = import.meta.env.PROD,
): { ok: true; config: AppConfig } | { ok: false; error: ConfigError } {
  try {
    return { ok: true, config: loadConfig(raw, isProduction) };
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, error: e };
    throw e;
  }
}
