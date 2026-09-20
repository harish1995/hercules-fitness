import { describe, expect, it } from 'vitest';
import { forgotPasswordSchema, loginSchema } from './auth';

/** US-1.1c / US-1.4b: empty or malformed input is blocked before any network call. */
// the FIRST issue per field is what the form shows (react-hook-form / zodResolver keep the first)
const messages = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) => {
  const out: Record<string, string> = {};
  for (const i of r.success ? [] : (r.error?.issues ?? [])) out[String(i.path[0])] ??= i.message;
  return out;
};

describe('loginSchema', () => {
  it('accepts a valid email and any non-empty password (the password is not trimmed or rule-checked at login)', () => {
    expect(loginSchema.safeParse({ email: ' owner@example.com ', password: ' spaces kept ' })).toMatchObject({
      success: true,
      data: { email: 'owner@example.com', password: ' spaces kept ' },
    });
  });

  it.each([
    [{ email: '', password: 'x' }, { email: 'Enter your email address' }],
    [{ email: '   ', password: 'x' }, { email: 'Enter your email address' }],
    [{ email: 'not-an-email', password: 'x' }, { email: 'Enter a valid email address' }],
    [{ email: 'a@b', password: 'x' }, { email: 'Enter a valid email address' }],
    [{ email: 'owner@example.com', password: '' }, { password: 'Enter your password' }],
  ])('%j -> %j', (input, expected) => {
    expect(messages(loginSchema.safeParse(input))).toMatchObject(expected);
  });
});

describe('forgotPasswordSchema', () => {
  it('needs only a valid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'owner@example.com' }).success).toBe(true);
    expect(messages(forgotPasswordSchema.safeParse({ email: 'nope' }))).toMatchObject({ email: 'Enter a valid email address' });
    expect(messages(forgotPasswordSchema.safeParse({ email: '' }))).toMatchObject({ email: 'Enter your email address' });
  });
});
