/** Client-safe contracts for explicit Lead -> Family / Contact / Student resolution. */

export const LEAD_IDENTITY_PREFERRED_CHANNELS = ["phone", "wechat", "other"] as const;

export type LeadIdentityPreferredChannel = (typeof LEAD_IDENTITY_PREFERRED_CHANNELS)[number];

export type LeadStudentResolution =
  | { mode: "existing"; id: string }
  | { mode: "create"; name: string; grade: number | null };

export type LeadFamilyResolution =
  | { mode: "existing"; id: string }
  | { mode: "create"; displayName: string };

export type LeadContactResolution =
  | { mode: "existing"; id: string }
  | { mode: "create"; displayName: string; phone: string; wechat: string };

export interface LeadIdentityInput {
  student: LeadStudentResolution;
  family: LeadFamilyResolution;
  contact: LeadContactResolution;
  relationship: {
    relation: string;
    isPrimaryFamily: boolean;
    isPrimaryContact: boolean;
    isDecisionMaker: boolean;
    preferredChannel: LeadIdentityPreferredChannel;
  };
  allowPossibleDuplicate: boolean;
  allowAdditionalRelationship: boolean;
}

export interface LeadIdentityStudentCandidate {
  id: string;
  name: string;
  grade: number | null;
  phone: string;
  parentName: string;
  parentPhone: string;
  suggested: boolean;
  phoneMatch: boolean;
  nameMatch: boolean;
}

export interface LeadIdentityFamilyCandidate {
  id: string;
  displayName: string;
  studentNames: string[];
  contactNames: string[];
}

export interface LeadIdentityContactCandidate {
  id: string;
  displayName: string;
  phone: string;
  wechat: string;
  familyNames: string[];
}

export interface LeadIdentityOptions {
  lead: {
    id: string;
    studentName: string;
    phone: string;
    grade: number | null;
    gradeText: string;
    wechatNickname: string;
    ownerId: string;
    suggestedStudentId: string | null;
  };
  canCreateStudent: boolean;
  students: LeadIdentityStudentCandidate[];
  families: LeadIdentityFamilyCandidate[];
  contacts: LeadIdentityContactCandidate[];
}

export interface LeadIdentityConfirmation {
  leadId: string;
  familyId: string;
  contactId: string;
  studentId: string;
  created: {
    family: boolean;
    contact: boolean;
    student: boolean;
  };
  nextActionMigrated: boolean;
}

/** Candidate warnings are advisory; the RPC repeats exact duplicate checks transactionally. */
export function leadIdentityHasPossibleDuplicate(
  options: LeadIdentityOptions,
  input: LeadIdentityInput,
): boolean {
  const normalizeName = (value: string) => value.trim().replace(/\s+/gu, "").toLowerCase();
  const normalizePhone = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    return /^86[1-9][0-9]{10}$/.test(digits) ? digits.slice(2) : digits;
  };
  const contact = input.contact;
  const student = input.student;
  const family = input.family;
  const contactPhone = contact.mode === "create"
    ? normalizePhone(contact.phone)
    : normalizePhone(options.contacts.find((candidate) => candidate.id === contact.id)?.phone ?? "");
  const studentDuplicate = student.mode === "create"
    && contactPhone.length > 0
    && options.students.some((candidate) => (
      normalizeName(candidate.name) === normalizeName(student.name)
      && [candidate.phone, candidate.parentPhone].some((phone) => normalizePhone(phone) === contactPhone)
    ));
  const familyDuplicate = family.mode === "create"
    && options.families.some((candidate) => (
      normalizeName(candidate.displayName) === normalizeName(family.displayName)
    ));
  const contactDuplicate = contact.mode === "create"
    && options.contacts.some((candidate) => normalizePhone(candidate.phone) === contactPhone);
  return studentDuplicate || familyDuplicate || contactDuplicate;
}
