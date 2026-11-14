import type { AuthUser, UserStore } from "@activescott/auth";
import type { PrismaClient, User } from "../generated/prisma/client";

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    metadata: { email: user.email, createdAt: user.createdAt.toISOString() },
  };
}

// The app's UserStore over the `users` table. Accounts are created only by an
// email sign-in (passkeys are added later, while signed in), so every user has
// the address they signed up with.
export function createUserStore(db: PrismaClient): UserStore {
  return {
    async findById(id) {
      const user = await db.user.findUnique({ where: { id } });
      return user && toAuthUser(user);
    },
    async create({ provider, identifier }) {
      if (provider !== "email") {
        throw new Error(
          `Accounts are created by email sign-in only, not ${provider}`,
        );
      }
      // The email provider has already normalised the address to lowercase.
      const user = await db.user.upsert({
        where: { email: identifier },
        create: { email: identifier },
        update: {},
      });
      return toAuthUser(user);
    },
    // Games and invites are keyed by user id, so merging two accounts would
    // orphan one player's games. Nothing in the app offers a merge.
    async onMerge() {
      throw new Error("Account merge is not supported");
    },
  };
}
