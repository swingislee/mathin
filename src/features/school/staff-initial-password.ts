import "server-only";

import { createHash, randomInt } from "node:crypto";

const INITIAL_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateStaffInitialPassword() {
  let password = "M!9";
  for (let index = 0; index < 15; index += 1) {
    password += INITIAL_PASSWORD_ALPHABET[randomInt(INITIAL_PASSWORD_ALPHABET.length)];
  }
  return password;
}

/** Matches the established staff_invitations.code_hash contract. */
export function staffInitialPasswordDigest(password: string) {
  return createHash("md5").update(password).digest("hex");
}
