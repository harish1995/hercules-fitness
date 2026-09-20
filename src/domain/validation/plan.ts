import { z } from 'zod';
import { DURATION_UNITS, isDurationUnit } from '../../constants/enums';
import { type PlanInput } from '../../types/membership';
import { collapseSpaces } from '../search';
import { MoneyError, toPaise } from '../money';
import { PLAN_DESCRIPTION_MAX, PLAN_NAME_MAX, planDurationError, planPriceError } from '../plan';

/** Raw plan form state: text inputs are strings (rupees, not paise), plus the active switch. */
export interface PlanFormValues {
  name: string;
  durationValue: string;
  durationUnit: string;
  price: string;
  description: string;
  active: boolean;
}

export const EMPTY_PLAN_FORM: PlanFormValues = {
  name: '',
  durationValue: '',
  durationUnit: 'MONTHS',
  price: '',
  description: '',
  active: true,
};

/** US-3.1b: a name, a positive whole duration, a price above 0 (at most 2 decimals). Uniqueness is checked by the service. */
export const planFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(PLAN_NAME_MAX, `Name must be at most ${PLAN_NAME_MAX} characters`),
    durationValue: z.string().trim(),
    durationUnit: z.string().refine(isDurationUnit, `Choose ${DURATION_UNITS.join(' or ').toLowerCase()}`),
    price: z.string().trim(),
    description: z.string().trim().max(PLAN_DESCRIPTION_MAX, `Description must be at most ${PLAN_DESCRIPTION_MAX} characters`),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: keyof PlanFormValues, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (v.durationValue === '') issue('durationValue', 'Duration is required');
    else if (!/^\d+$/.test(v.durationValue)) issue('durationValue', 'Duration must be a whole number');
    else if (isDurationUnit(v.durationUnit)) {
      const msg = planDurationError(Number(v.durationValue), v.durationUnit);
      if (msg) issue('durationValue', msg);
    }

    if (v.price === '') issue('price', 'Price is required');
    else {
      try {
        const msg = planPriceError(toPaise(v.price));
        if (msg) issue('price', msg);
      } catch (e) {
        issue('price', e instanceof MoneyError ? e.message : 'Enter a valid price');
      }
    }
  });

/** Convert VALIDATED form values into the typed plan input (price in integer paise). Throws if not validated first. */
export function toPlanInput(values: PlanFormValues): PlanInput {
  if (!isDurationUnit(values.durationUnit)) throw new Error('toPlanInput called with unvalidated values');
  const description = collapseSpaces(values.description);
  return {
    name: collapseSpaces(values.name),
    durationValue: Number(values.durationValue),
    durationUnit: values.durationUnit,
    pricePaise: toPaise(values.price),
    description: description === '' ? null : description,
    active: values.active,
  };
}
