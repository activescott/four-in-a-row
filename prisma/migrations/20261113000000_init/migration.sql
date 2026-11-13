-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('INVITED', 'ACTIVE', 'WON', 'DRAW');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "player_one_id" TEXT NOT NULL,
    "player_two_id" TEXT,
    "status" "GameStatus" NOT NULL,
    "next_player_id" TEXT,
    "winner_id" TEXT,
    "move_count" INTEGER NOT NULL DEFAULT 0,
    "player_one_seen_at" TIMESTAMP(3),
    "player_two_seen_at" TIMESTAMP(3),
    "rematch_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moves" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "player_id" TEXT NOT NULL,
    "column" INTEGER NOT NULL,
    "row" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "turn_email_claimed_at" TIMESTAMP(3),

    CONSTRAINT "moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "inviter_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "identities_provider_identifier_key" ON "identities"("provider", "identifier");

-- CreateIndex
CREATE INDEX "games_player_one_id_idx" ON "games"("player_one_id");

-- CreateIndex
CREATE INDEX "games_player_two_id_idx" ON "games"("player_two_id");

-- CreateIndex
CREATE UNIQUE INDEX "moves_game_id_number_key" ON "moves"("game_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invites_game_id_key" ON "invites"("game_id");

-- AddForeignKey
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moves" ADD CONSTRAINT "moves_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
