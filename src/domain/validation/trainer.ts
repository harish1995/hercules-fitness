import { z } from 'zod';
import { type TrainerInput } from '../../types/member';
import { normalizeMobile } from '../search';

export const TRAINER_NAME_MAX = 80;

export interface TrainerFormValues {
  name: string;
  mobile: string;
  active: boolean;
}

/** Trainer: name required, mobile optional (valid Indian mobile when present), active flag (NEW-2). */
export const trainerFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(TRAINER_NAME_MAX, `Name must be at most ${TRAINER_NAME_MAX} characters`),
    mobile: z.string().trim(),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.mobile !== '' && normalizeMobile(v.mobile) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mobile'],
        message: 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9',
      });
    }
  });

export function toTrainerInput(values: TrainerFormValues): TrainerInput {
  return {
    name: values.name.replace(/\s+/g, ' ').trim(),
    mobile: values.mobile.trim() === '' ? null : normalizeMobile(values.mobile),
    active: values.active,
  };
}
