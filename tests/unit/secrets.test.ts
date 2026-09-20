import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * US-8.2c: no secrets or service-account keys are committed, and `.env` is ignored. This project is not a git repository yet, so
 * "committed" means "present in the project tree outside the ignored paths": those files are exactly what a first `git add .` would
 * take. The scan is text-only, offline and reads no file outside the project.
 */
const ROOT = process.cwd();
const gitignore = readFileSync(resolve(ROOT, '.gitignore'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'));

/** Directories and files that are ignored by .gitignore, or are tool output that is regenerated (not part of the source tree). */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.firebase', '.git', '.vscode', '.idea']);
const isIgnoredFile = (name: string): boolean =>
  (/^\.env(\..+)?$/.test(name) && name !== '.env.example') || /-debug\.log$/.test(name) || name === '.DS_Store' || /\.tsbuildinfo$/.test(name);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith('firebase-export-')) walk(path, out);
    } else if (!isIgnoredFile(name)) {
      out.push(path);
    }
  }
  return out;
}
const candidates = walk(ROOT).filter((f) => !/\.(png|jpe?g|ico|webp|woff2?)$/i.test(f) && statSync(f).size < 2_000_000);
const text = (f: string) => readFileSync(f, 'utf8');
const rel = (f: string) => relative(ROOT, f);

describe('.gitignore protects secrets', () => {
  it('ignores .env and every .env.* except the template', () => {
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.env.*');
    expect(gitignore).toContain('!.env.example');
  });

  it('ignores service-account and private-key files, build output and emulator state', () => {
    for (const pattern of ['*firebase-adminsdk*.json', 'serviceAccount*.json', '*.pem', 'node_modules', 'dist', '.firebase', 'firebase-debug.log*', 'firestore-debug.log']) {
      expect(gitignore, `missing ${pattern}`).toContain(pattern);
    }
  });
});

describe('the project tree contains no secret material', () => {
  it('has no service-account or private-key files by name', () => {
    const bad = candidates.filter((f) => /firebase-adminsdk|serviceAccount|\.pem$|\.p12$|\.pfx$|id_rsa|\.keystore$/i.test(f));
    expect(bad.map(rel)).toEqual([]);
  });

  it('has no private key, service-account JSON or Google API key in any file', () => {
    const patterns: [string, RegExp][] = [
      ['a PEM private key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
      ['a service-account JSON "private_key"', /"private_key"\s*:/],
      ['a service-account JSON type', /"type"\s*:\s*"service_account"/],
      ['a Google API key (AIza...)', /AIza[0-9A-Za-z_-]{35}/],
      ['an OAuth client secret', /GOCSPX-[0-9A-Za-z_-]{20,}/],
      ['a GitHub / npm token', /\b(?:ghp_|gho_|github_pat_|npm_)[0-9A-Za-z_]{20,}/],
      ['an AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
    ];
    const hits: string[] = [];
    for (const f of candidates) {
      const body = text(f);
      for (const [label, re] of patterns) if (re.test(body)) hits.push(`${rel(f)}: ${label}`);
    }
    expect(hits).toEqual([]);
  });

  it('never uses the Admin SDK: no firebase-admin dependency or import', () => {
    const pkg = text(resolve(ROOT, 'package.json'));
    expect(pkg).not.toMatch(/firebase-admin/);
    const importing = candidates.filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f) && /from\s+['"]firebase-admin|require\(['"]firebase-admin/.test(text(f)));
    expect(importing.map(rel)).toEqual([]);
  });

  it('.env.example holds keys only, with no value filled in', () => {
    const example = text(resolve(ROOT, '.env.example'))
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l));
    expect(example.length).toBeGreaterThanOrEqual(5);
    for (const line of example) {
      const [key, value] = [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)];
      if (key.startsWith('VITE_FIREBASE_')) expect(value, key).toBe('');
    }
  });

  it('the real local values (.env.local, if present) appear in no other file of the tree', () => {
    const local = resolve(ROOT, '.env.local');
    if (!existsSync(local)) return; // nothing to compare against on a fresh checkout / CI
    const values = text(local)
      .split('\n')
      .map((l) => l.match(/^VITE_FIREBASE_(?:API_KEY|APP_ID|MESSAGING_SENDER_ID)=(.+)$/)?.[1]?.trim())
      .filter((v): v is string => !!v && v.length >= 8 && !/^demo/i.test(v));
    const leaks: string[] = [];
    for (const f of candidates) {
      const body = text(f);
      for (const v of values) if (body.includes(v)) leaks.push(rel(f));
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('render.yaml never carries a Firebase value: the five VITE_FIREBASE_* keys are `sync: false` (entered in the Render dashboard)', () => {
    const yaml = text(resolve(ROOT, 'render.yaml'));
    for (const key of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID']) {
      expect(yaml).toMatch(new RegExp(`key: ${key}\\n\\s+sync: false`));
    }
    expect(yaml).not.toMatch(/VITE_USE_EMULATORS/);
  });
});
