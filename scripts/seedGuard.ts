/**
 * Seed safety (R-7). The seed may ONLY run against the local Firestore emulator. It never needs, reads or accepts a
 * service-account key, and it refuses anything that is not a loopback emulator address, so it cannot be pointed
 * at a real Firebase project (including a dev one) by accident.
 */
export const SEED_PROJECT_ID = 'demo-hercules-fitness'; // "demo-" ids can never reach a real Firebase project
export const DEFAULT_EMULATOR_HOST = '127.0.0.1:8080';

export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(`Seed refused: ${message}`);
    this.name = 'SeedRefusedError';
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface SeedTarget {
  host: string;
  port: number;
  authEmulator: { host: string; port: number } | null;
}

function parseHostPort(raw: string, what: string): { host: string; port: number } {
  const trimmed = raw.trim();
  const i = trimmed.lastIndexOf(':');
  const host = i > 0 ? trimmed.slice(0, i) : trimmed;
  const port = i > 0 ? Number(trimmed.slice(i + 1)) : NaN;
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new SeedRefusedError(`${what} must look like 127.0.0.1:8080 (got "${raw}")`);
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new SeedRefusedError(`${what} "${raw}" is not a local emulator (only 127.0.0.1 / localhost / ::1 are allowed)`);
  }
  return { host, port };
}

/**
 * The places Firebase tooling puts the project it is pointed at (`firebase ... --project X` exports GCLOUD_PROJECT and
 * FIREBASE_CONFIG to the commands it runs). The seed itself always uses the fixed `demo-` id above, but if ANY of these names a real
 * project the run is happening under production-pointed tooling, and the seed refuses (US-8.4b). `VITE_FIREBASE_PROJECT_ID` is
 * deliberately NOT in this list: it is the WEB APP's config (a developer's `.env.local` normally holds the real project), and the
 * seed never reads it or connects to anything but the loopback emulator.
 */
const PROJECT_ID_ENV_KEYS = ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT', 'FIREBASE_PROJECT_ID'] as const;

/** `demo-` ids can never reach a real Firebase project (the emulator rejects everything else for them). Anything else is treated as production. */
export function isDemoProjectId(projectId: string): boolean {
  return /^demo-[a-z0-9-]+$/.test(projectId.trim());
}

/** Project ids named by the environment, including the JSON in FIREBASE_CONFIG (set by Firebase tooling). */
function namedProjectIds(env: Record<string, string | undefined>): string[] {
  const ids: string[] = [];
  for (const key of PROJECT_ID_ENV_KEYS) {
    const v = env[key]?.trim();
    if (v) ids.push(v);
  }
  if (env.FIREBASE_CONFIG?.trim()) {
    try {
      const parsed: unknown = JSON.parse(env.FIREBASE_CONFIG);
      const id = typeof parsed === 'object' && parsed !== null ? (parsed as { projectId?: unknown }).projectId : undefined;
      if (typeof id === 'string' && id.trim()) ids.push(id.trim());
    } catch {
      throw new SeedRefusedError('FIREBASE_CONFIG is set but is not valid JSON, so the project it names cannot be checked');
    }
  }
  return ids;
}

/** Validate the environment and return the emulator to seed, or throw SeedRefusedError. Pure: takes the env as data. */
export function assertSeedTarget(env: Record<string, string | undefined>): SeedTarget {
  if (env.NODE_ENV === 'production') throw new SeedRefusedError('NODE_ENV is production');
  for (const id of namedProjectIds(env)) {
    if (!isDemoProjectId(id)) {
      throw new SeedRefusedError(
        `the environment names the project "${id}", which is not a demo-* project. The seed only runs against the local emulator; unset it (or use a demo-* id).`,
      );
    }
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new SeedRefusedError('GOOGLE_APPLICATION_CREDENTIALS is set. The seed never uses service-account credentials; unset it.');
  }
  const { host, port } = parseHostPort(env.FIRESTORE_EMULATOR_HOST ?? DEFAULT_EMULATOR_HOST, 'FIRESTORE_EMULATOR_HOST');
  const authRaw = env.FIREBASE_AUTH_EMULATOR_HOST;
  const authEmulator = authRaw ? parseHostPort(authRaw, 'FIREBASE_AUTH_EMULATOR_HOST') : null;
  return { host, port, authEmulator };
}
