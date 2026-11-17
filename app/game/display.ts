const localPart = (email: string) => email.split("@")[0]!.toLowerCase();

/**
 * What to call a player: the part of their email before the @. Pass the
 * player's other opponents as `others`: when a different address among them
 * shares that part (bob@a.com and bob@b.com), the full address is shown so
 * the two can be told apart.
 */
export function displayName(
  email: string | null,
  others: readonly (string | null)[] = [],
): string {
  if (!email) return "Invited player";
  const short = email.split("@")[0] || email;
  const clash = others.some(
    (other) =>
      other !== null &&
      other.toLowerCase() !== email.toLowerCase() &&
      localPart(other) === localPart(email),
  );
  return clash ? email : short;
}

/**
 * An address shown to whoever holds an invite link: enough for the invitee
 * to recognise (b•••@example.com), not enough for anyone else to learn.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return `${email[0] ?? ""}•••${at > 0 ? email.slice(at) : ""}`;
}

/** The draws part of a record ("1 draw", "2 draws"), empty when there are none. */
export function drawsLabel(drawn: number): string {
  return drawn === 0 ? "" : `${drawn} ${drawn === 1 ? "draw" : "draws"}`;
}
