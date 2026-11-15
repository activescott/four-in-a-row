/** What to call a player: the part of their email before the @. */
export function displayName(email: string | null): string {
  if (!email) return "Invited player";
  return email.split("@")[0] || email;
}
