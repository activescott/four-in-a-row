/** What to call a player: the part of their email before the @. */
export function displayName(email: string | null): string {
  if (!email) return "Invited player";
  return email.split("@")[0] || email;
}

/**
 * An address shown to whoever holds an invite link: enough for the invitee
 * to recognise (b•••@example.com), not enough for anyone else to learn.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return `${email[0] ?? ""}•••${at > 0 ? email.slice(at) : ""}`;
}
