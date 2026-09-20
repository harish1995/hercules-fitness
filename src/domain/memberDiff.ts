import { type EmergencyContact, type MemberProfileInput } from '../types/member';

/** Profile fields an edit may change, in a stable order (audit metadata lists these NAMES only, FR-13). */
export const PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'gender',
  'dateOfBirth',
  'mobile',
  'email',
  'address',
  'emergencyContact',
  'trainerId',
  'joiningDate',
  'generalNotes',
] as const satisfies readonly (keyof MemberProfileInput)[];

export type ProfileField = (typeof PROFILE_FIELDS)[number];

function sameContact(a: EmergencyContact | null, b: EmergencyContact | null): boolean {
  if (a === null || b === null) return a === b;
  return a.name === b.name && a.mobile === b.mobile;
}

/** Names of the profile fields whose values differ between the stored member and the edited input. */
export function changedProfileFields(before: MemberProfileInput, after: MemberProfileInput): ProfileField[] {
  return PROFILE_FIELDS.filter((field) => {
    switch (field) {
      case 'dateOfBirth':
      case 'joiningDate':
        return before[field].getTime() !== after[field].getTime();
      case 'emergencyContact':
        return !sameContact(before.emergencyContact, after.emergencyContact);
      default:
        return before[field] !== after[field];
    }
  });
}

/** Audit `entityLabel` for a member: readable without a join (§2.6). */
export function memberAuditLabel(memberId: string, displayName: string): string {
  return `${memberId} ${displayName}`;
}

/** The editable profile of a stored member (what an edit form starts from and is diffed against). */
export function profileOfMember(member: MemberProfileInput): MemberProfileInput {
  return {
    firstName: member.firstName,
    lastName: member.lastName,
    gender: member.gender,
    dateOfBirth: member.dateOfBirth,
    mobile: member.mobile,
    email: member.email,
    address: member.address,
    emergencyContact: member.emergencyContact,
    trainerId: member.trainerId,
    joiningDate: member.joiningDate,
    generalNotes: member.generalNotes,
  };
}
