## Requirements

Micah asked on 2026-11-17 for the profile page to show "how good you're doing" (games won out of games played) and "maybe some awards". Today the profile shows only your email, when you joined and your sign-in methods. Your record against each opponent appears only on the games list and the game page ("You 2 · jonah 3 · 1 draw"), one opponent at a time, and there is no total anywhere.

Nothing here is a design.

### Problem

- P1. A player can't see how they are doing overall. Evidence: Micah's email of 2026-11-17, "how good you're doing".
- P2. A player has nothing to aim for beyond the next game. Evidence: the same email, "maybe some awards".
- P3. Comparing opponents means opening each game in turn; the record against everyone is never in one place. Evidence: the score line is drawn per game row in `app/routes/games.tsx` and `app/routes/games.$id.tsx`, from `tally()` in `app/game/record.server.ts`.

### What the data already gives us

Every number below comes from `games` rows the app already keeps: `status` (WON or DRAW counts as finished), `winnerId`, `finishedAt`, the two players, and `moves` (numbered per game). `tally()` already counts wins, losses and draws per opponent. Games still being played or waiting on an invite don't count. There is no resign or abandon, so every counted game was played to the end.

### Requirements

1. The profile page shows **Your record** first, above the sign-in settings: games finished, wins, losses and draws, against everyone. Wins read in words, "12 wins out of 20 games", with no percentage. (P1)
2. Under it, the profile lists **Against each person**: one row per opponent with at least one finished game, showing wins, losses and draws in the same form as the existing score line ("You 7 · grandma 5 · 1 draw"), most games played first. Opponents are named by `displayName()`, as on the games list. (P1, P3)
3. With no finished games, the record reads "No finished games yet" and the per-opponent list is not shown. (P1)
4. The profile shows **Awards**, these 6 to start, each earned once:
   - **First win**: win a game. Every new player can get one early.
   - **Ten wins**: win 10 games. A longer goal for the same player.
   - **Hat trick**: win 3 finished games in a row, by `finishedAt`, against anyone. A draw or loss ends the run.
   - **Full board**: finish a game in a draw. Draws need all 42 squares filled, so they mean a close game, and both players earn it.
   - **Regular**: finish 25 games, won or not. Rewards playing, so a younger or newer player earns it as fast as a strong one.
   - **Rematch!**: finish 5 games against the same person. Rewards playing together, which is what the app is for.

   Three of the six (Full board, Regular, Rematch!) can be earned without winning, so a child who loses most games to an older sibling still collects awards. None is earned by losing, and none compares you with another player. (P2)

5. An award not yet earned shows greyed out with how to earn it and how far along you are ("Ten wins: 6 of 10"). An earned award shows the date of the game that earned it. (P2)
6. Records and awards are worked out from finished games when the page loads, so games already played count the moment this ships. Nothing new is stored per game. (P1, P2)
7. Only you see your own record and awards. (P1, P2)

### Out of scope

- A leaderboard or any view of another player's record: it turns a family game into a ranking.
- Awards for losing, or anything shown to the opponent when you earn one.
- Telling you about a new award by email or on the game page. Possible later; it needs a stored "seen" flag, which R6 rules out for now.
- Changing the sign-in settings part of the profile.

### Low-fidelity layout

Phone width, one column, in page order. Numbers in brackets are the requirements each part serves.

```
← Your games

Profile
+------------------------------------------+
| Your record                        [1]   |
| 12 wins out of 20 games                  |
| 7 lost · 1 draw                          |
+------------------------------------------+
| Against each person                [2]   |
| You 7 · grandma 5 · 1 draw               |
| You 3 · jonah 2                          |
| You 2 · micah 0                          |
+------------------------------------------+
| Awards                           [4][5]  |
| [x] First win        14 Nov 2026         |
| [x] Rematch!         20 Nov 2026         |
| [ ] Hat trick        best run 2 of 3     |
| [ ] Ten wins         6 of 10             |
| [ ] Full board       draw a game         |
| [ ] Regular          20 of 25 games      |
+------------------------------------------+
| (existing) email, member since,          |
| sign-in methods                          |
+------------------------------------------+
```

No finished games yet (R3):

```
| Your record                              |
| No finished games yet                    |
+------------------------------------------+
| Awards                                   |
| [ ] First win        win a game          |
| ...all six greyed, with how to earn      |
```

Earned awards sort before unearned ones. `[x]` and `[ ]` stand for earned and greyed; the look is for the design step.

Verified when: Micah opens his profile on production and sees his win count out of games played, his record against each person he has finished a game with, and the awards he has earned. (operator checks)

### Decisions

Scott answered all 7 questions by taking the recommended option, on 2026-11-26. These are settled.

1. **Awards:** the 6 awards above ship. Micah is asked for more afterwards.
2. **Per-opponent list:** it is on the profile (R2), alongside the games list, where each score is still shown.
3. **Wins as words:** "12 wins out of 20 games", not a percentage (R1).
4. **Hat trick:** wins against anyone count toward it, not only wins against the same person (R4).
5. **Unearned awards:** shown greyed out with progress, so there is something to aim for (R5).
6. **Privacy:** your record and awards are private to you (R7).
7. **"New award!" note:** not part of this work. It is a later issue of its own (see Out of scope).
