import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, readConfig, REQUIRED_ENV_KEYS } from './env';

const valid = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-project',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
};

describe('loadConfig (US-1.8b)', () => {
  it('accepts a complete config and defaults optional values', () => {
    const config = loadConfig(valid);
    expect(config.firebase.projectId).toBe('demo-project');
    expect(config.useEmulators).toBe(false);
    expect(config.emulatorHost).toBe('127.0.0.1');
  });

  it.each(REQUIRED_ENV_KEYS)('names %s when it is missing', (key) => {
    const raw: Record<string, string> = { ...valid };
    delete raw[key];
    try {
      loadConfig(raw);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).missingKeys).toEqual([key]);
      expect((e as ConfigError).message).toContain(key);
    }
  });

  it('treats blank/whitespace values as missing', () => {
    expect(() => loadConfig({ ...valid, VITE_FIREBASE_API_KEY: '   ' })).toThrow(ConfigError);
  });

  it('lists every missing key at once', () => {
    try {
      loadConfig({});
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as ConfigError).missingKeys).toEqual([...REQUIRED_ENV_KEYS]);
    }
  });

  it('never puts values in the error message (a secret-looking value of ANOTHER key is present in the input)', () => {
    const SECRET = 'AIzaSy-DISTINCTIVE-SECRET-9f8e7d6c';
    const raw = { ...valid, VITE_FIREBASE_API_KEY: SECRET, VITE_FIREBASE_APP_ID: '' };
    let caught: unknown;
    try {
      loadConfig(raw);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError); // guards against the test passing vacuously
    const error = caught as ConfigError;
    expect(error.message).toContain('VITE_FIREBASE_APP_ID');
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain('demo-project');
    expect(error.missingKeys).toEqual(['VITE_FIREBASE_APP_ID']);
    expect(JSON.stringify(error.missingKeys)).not.toContain(SECRET);
  });

  it('does not echo a rejected value either (invalid VITE_USE_EMULATORS)', () => {
    const SECRET = 'not-a-boolean-DISTINCTIVE-1a2b3c';
    let caught: unknown;
    try {
      loadConfig({ ...valid, VITE_USE_EMULATORS: SECRET });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toContain('VITE_USE_EMULATORS');
    expect((caught as ConfigError).message).not.toContain(SECRET);
  });

  it('enables emulators only when explicitly "true", and refuses them in production', () => {
    expect(loadConfig({ ...valid, VITE_USE_EMULATORS: 'true' }).useEmulators).toBe(true);
    expect(() => loadConfig({ ...valid, VITE_USE_EMULATORS: 'true' }, true)).toThrow(ConfigError);
    expect(() => loadConfig({ ...valid, VITE_USE_EMULATORS: 'yes' })).toThrow(ConfigError);
  });
});

describe('readConfig', () => {
  it('returns a result object instead of throwing', () => {
    expect(readConfig(valid, false).ok).toBe(true);
    const bad = readConfig({}, false);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.missingKeys.length).toBe(REQUIRED_ENV_KEYS.length);
  });
});
