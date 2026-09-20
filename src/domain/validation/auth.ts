import { z } from 'zod';

const email = z
  .string()
  .trim()
  .min(1, 'Enter your email address')
  .email('Enter a valid email address');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
});
export type LoginFormValues = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
