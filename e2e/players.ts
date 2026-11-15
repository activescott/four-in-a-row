// Each browser project signs in its own pair of players, so no two projects
// share an address or its per-address sign-in limit.
export const inviterEmail = (project: string) => `a-${project}@example.com`;
export const inviteeEmail = (project: string) => `b-${project}@example.com`;
