import { z } from 'zod';
import { GENDERS, isGender } from '../../constants/enums';
import { type MemberProfileInput } from '../../types/member';
import { ageOnIstDate, parseDayInput, systemClock, type Clock } from '../dates';
import { normalizeMobile } from '../search';
import { validatePaymentForm, type PaymentFormValues } from './payment';

/** Field limits from the validation matrix (NEW-15). */
export const NAME_MAX = 50;
export const NOTES_MAX = 1000;
export const ADDRESS_MAX = 500;
export const EMAIL_MAX = 254;
export const MAX_AGE_YEARS = 100;

/** Raw form state: every input is a string (native date inputs give `YYYY-MM-DD`), plus the consent box. */
export interface MemberFormValues extends PaymentFormValues {
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  mobile: string;
  email: string;
  address: string;
  emergencyName: string;
  emergencyMobile: string;
  trainerId: string;
  joiningDate: string;
  generalNotes: string;
  medicalNotes: string;
  consent: boolean;
  /** Registration by an Admin only: the plan to assign together with the member ('' = none yet). */
  planId: string;
  /** `YYYY-MM-DD`, only read when a plan is chosen. */
  membershipStart: string;
  // + the optional first payment (`paymentAmount`, `paymentDate`, `paymentMethod`, `paymentReference`, `paymentNotes`), Admin
  // registration with a plan only (US-4.2); blank Amount Paid = no payment.
}

export const EMPTY_MEMBER_FORM: MemberFormValues = {
  firstName: '',
  lastName: '',
  gender: '',
  dateOfBirth: '',
  mobile: '',
  email: '',
  address: '',
  emergencyName: '',
  emergencyMobile: '',
  trainerId: '',
  joiningDate: '',
  generalNotes: '',
  medicalNotes: '',
  consent: false,
  planId: '',
  membershipStart: '',
  paymentAmount: '',
  paymentDate: '',
  paymentMethod: '',
  paymentReference: '',
  paymentNotes: '',
};

export type MemberFormMode = 'create' | 'edit';

const emailSchema = z.string().email();

const required = (label: string) => z.string().trim().min(1, `${label} is required`);

/**
 * The registration / edit form schema (US-2.4, US-2.7). `clock` supplies "today" (IST) for the
 * future-date, age and under-18 rules so the rules are deterministic under test. Consent is required
 * on registration only (it is a record made at registration, never re-asked on edit).
 *
 * The schema is string-in / string-out on purpose (React Hook Form keeps strings); conversion to typed,
 * IST-anchored values is `toMemberProfileInput`.
 */
export function buildMemberFormSchema(
  mode: MemberFormMode,
  clock: Clock = systemClock,
  /** plan id -> price (paise) of the plans an Admin can assign: needed to check the first payment against the total. */
  planPricesPaise?: Readonly<Record<string, number>>,
) {
  return z
    .object({
      firstName: required('First name').max(NAME_MAX, `First name must be at most ${NAME_MAX} characters`),
      lastName: required('Last name').max(NAME_MAX, `Last name must be at most ${NAME_MAX} characters`),
      gender: z.string().refine(isGender, `Select a gender (${GENDERS.join(' / ').toLowerCase()})`),
      dateOfBirth: z.string().trim(),
      mobile: z.string().trim(),
      email: z.string().trim(),
      address: z.string().trim().max(ADDRESS_MAX, `Address must be at most ${ADDRESS_MAX} characters`),
      emergencyName: z.string().trim().max(NAME_MAX, `Name must be at most ${NAME_MAX} characters`),
      emergencyMobile: z.string().trim(),
      trainerId: z.string().trim(),
      joiningDate: z.string().trim(),
      generalNotes: z.string().trim().max(NOTES_MAX, `Notes must be at most ${NOTES_MAX} characters`),
      medicalNotes: z.string().trim().max(NOTES_MAX, `Notes must be at most ${NOTES_MAX} characters`),
      consent: z.boolean(),
      planId: z.string().trim(),
      membershipStart: z.string().trim(),
      paymentAmount: z.string().trim(),
      paymentDate: z.string().trim(),
      paymentMethod: z.string().trim(),
      paymentReference: z.string(),
      paymentNotes: z.string(),
    })
    .superRefine((v, ctx) => {
      const today = clock();
      const issue = (path: keyof MemberFormValues, message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

      // Date of birth: required, real date, not in the future, age <= 100.
      const dob = parseDayInput(v.dateOfBirth);
      let under18 = false;
      if (v.dateOfBirth === '') issue('dateOfBirth', 'Date of birth is required');
      else if (!dob) issue('dateOfBirth', 'Enter a valid date of birth');
      else if (dob.getTime() > today.getTime()) issue('dateOfBirth', 'Date of birth cannot be in the future');
      else {
        const age = ageOnIstDate(dob, today);
        if (age > MAX_AGE_YEARS) issue('dateOfBirth', `Age cannot be more than ${MAX_AGE_YEARS} years`);
        under18 = age < 18;
      }

      // Joining date: required, real date, not in the future.
      const joining = parseDayInput(v.joiningDate);
      if (v.joiningDate === '') issue('joiningDate', 'Joining date is required');
      else if (!joining) issue('joiningDate', 'Enter a valid joining date');
      else if (joining.getTime() > today.getTime()) issue('joiningDate', 'Joining date cannot be in the future');

      // Mobile: 10 digits starting 6-9 after normalization.
      if (v.mobile === '') issue('mobile', 'Mobile number is required');
      else if (normalizeMobile(v.mobile) === null) {
        issue('mobile', 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9');
      }

      // Email: optional, valid when present.
      if (v.email !== '') {
        if (v.email.length > EMAIL_MAX || !emailSchema.safeParse(v.email).success) {
          issue('email', 'Enter a valid email address');
        }
      }

      // Emergency contact: both-or-neither; required (as guardian) for under-18.
      const noun = under18 ? 'Guardian' : 'Emergency contact';
      if (v.emergencyName === '' && (under18 || v.emergencyMobile !== '')) {
        issue('emergencyName', `${noun} name is required`);
      }
      if (v.emergencyMobile === '') {
        if (under18 || v.emergencyName !== '') issue('emergencyMobile', `${noun} mobile number is required`);
      } else if (normalizeMobile(v.emergencyMobile) === null) {
        issue('emergencyMobile', 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9');
      }

      // Membership (registration only, and only when a plan is chosen): the start must be a real calendar day. Any day is
      // accepted, past or future (NEW-5); the end date and amount are computed, never typed (NEW-3, NEW-4).
      if (mode === 'create' && v.planId !== '') {
        if (v.membershipStart === '') issue('membershipStart', 'Membership start date is required');
        else if (!parseDayInput(v.membershipStart)) issue('membershipStart', 'Enter a valid start date');
      }

      // First payment (Admin registration with a plan, US-4.2): Amount Paid 0 / blank = no payment and nothing else is required;
      // Amount Paid > 0 needs a mode and a valid, not-future date, and may not exceed the total (the plan price).
      const planPrice = mode === 'create' && v.planId !== '' ? (planPricesPaise?.[v.planId] ?? null) : null;
      if (planPrice !== null) {
        const { errors } = validatePaymentForm(v, { capPaise: planPrice, required: false, clock });
        for (const [key, message] of Object.entries(errors)) issue(key as keyof MemberFormValues, message);
      }

      // Consent: required on registration; for a minor it is the guardian's consent.
      if (mode === 'create' && !v.consent) {
        issue('consent', under18 ? 'Guardian consent is required for a member under 18' : 'Consent is required to register a member');
      }
    });
}

export type MemberFormSchema = ReturnType<typeof buildMemberFormSchema>;

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/**
 * Convert VALIDATED form values into the typed, normalized profile (dates re-anchored to 00:00 IST from the
 * Y/M/D the user saw, mobile normalized, empty strings -> null, names trimmed and space-collapsed).
 * Throws if the values were not validated first.
 */
export function toMemberProfileInput(values: MemberFormValues): MemberProfileInput {
  const dob = parseDayInput(values.dateOfBirth);
  const joining = parseDayInput(values.joiningDate);
  const mobile = normalizeMobile(values.mobile);
  if (!dob || !joining || !mobile || !isGender(values.gender)) {
    throw new Error('toMemberProfileInput called with unvalidated values');
  }
  const emergencyMobile = values.emergencyMobile.trim() === '' ? null : normalizeMobile(values.emergencyMobile);
  const emergencyName = values.emergencyName.replace(/\s+/g, ' ').trim();
  return {
    firstName: values.firstName.replace(/\s+/g, ' ').trim(),
    lastName: values.lastName.replace(/\s+/g, ' ').trim(),
    gender: values.gender,
    dateOfBirth: dob,
    mobile,
    email: orNull(values.email),
    address: orNull(values.address),
    emergencyContact: emergencyName !== '' && emergencyMobile ? { name: emergencyName, mobile: emergencyMobile } : null,
    trainerId: orNull(values.trainerId),
    joiningDate: joining,
    generalNotes: orNull(values.generalNotes),
  };
}
