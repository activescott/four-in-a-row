# Changelog

## [0.3.0](https://github.com/activescott/four-in-a-row/compare/four-in-a-row-v0.2.0...four-in-a-row-v0.3.0) (2026-11-16)


### Features

* land on Your games with a clear New game button and a top-right account menu ([#68](https://github.com/activescott/four-in-a-row/issues/68)) ([e5f880d](https://github.com/activescott/four-in-a-row/commit/e5f880dbaa1ccfc2b9265406ee022dd1fe7353fa))
* signed-out home page that explains the game ([#81](https://github.com/activescott/four-in-a-row/issues/81)) ([3acd977](https://github.com/activescott/four-in-a-row/commit/3acd977e6c64bc429552e7f28e5c5e378e378516))


### Bug Fixes

* 3 tries per sign-in code and a 6/hour, 24/day per-address cap ([#64](https://github.com/activescott/four-in-a-row/issues/64)) ([439669c](https://github.com/activescott/four-in-a-row/commit/439669ce6944a08715de4826be45563d629a3ba7))
* control borders at 3:1 and a clear way back to Your games ([#75](https://github.com/activescott/four-in-a-row/issues/75)) ([9448b07](https://github.com/activescott/four-in-a-row/commit/9448b07a2c57ac7f3bd4e21bfd122b399a4b3632))
* **deps:** minimatch &gt;=11.0.1 for Dependabot alert 1 ([#66](https://github.com/activescott/four-in-a-row/issues/66)) ([b3bc4a1](https://github.com/activescott/four-in-a-row/commit/b3bc4a10616f2d2612dd545d61cf7ccb70631b77))
* home and sign-in page polish ([#61](https://github.com/activescott/four-in-a-row/issues/61)) ([5432bc9](https://github.com/activescott/four-in-a-row/commit/5432bc9aceeb91212f44fd14711fb77f54c1da01))
* sign-in sent message no longer says you need an invite ([#80](https://github.com/activescott/four-in-a-row/issues/80)) ([d15e7e7](https://github.com/activescott/four-in-a-row/commit/d15e7e7b5400cfeb1a484234b941325827a3f75f))
* tag-aware send-limit buckets, per-IP daily cap, startup prune, README limits ([#62](https://github.com/activescott/four-in-a-row/issues/62)) ([dec48b1](https://github.com/activescott/four-in-a-row/commit/dec48b1fec584902c2f3178505fd9652ebae58fe))

## [0.2.0](https://github.com/activescott/four-in-a-row/compare/four-in-a-row-v0.1.0...four-in-a-row-v0.2.0) (2026-11-16)


### Features

* game-aware sign-in email ([#48](https://github.com/activescott/four-in-a-row/issues/48)) ([d6e21e5](https://github.com/activescott/four-in-a-row/commit/d6e21e5e956c48e72a38486c8e10880b4cc4db84))
* invite a player by email to start a game ([#42](https://github.com/activescott/four-in-a-row/issues/42)) ([e1f8b82](https://github.com/activescott/four-in-a-row/commit/e1f8b82eef2769e38bcea2add27abe0bd10866d9))
* open sign-up with per-address, per-IP and site-wide email limits ([#59](https://github.com/activescott/four-in-a-row/issues/59)) ([9c2cb31](https://github.com/activescott/four-in-a-row/commit/9c2cb31d7e72561182156d434ff4d5b6c4ab9ca4))
* update the board live by polling /state ([#36](https://github.com/activescott/four-in-a-row/issues/36)) ([076103e](https://github.com/activescott/four-in-a-row/commit/076103ec416368fa931bf2750a01272293dea635))


### Bug Fixes

* bigger legend swatch on laptop screens ([#54](https://github.com/activescott/four-in-a-row/issues/54)) ([b8cbf9a](https://github.com/activescott/four-in-a-row/commit/b8cbf9a9fa9b06de2a019bb2d2a5ec75c6886b14))
* finished-board contrast, unique opponent names and review nits ([#47](https://github.com/activescott/four-in-a-row/issues/47)) ([9af66fa](https://github.com/activescott/four-in-a-row/commit/9af66fab92080044b68228dc5584c99c15d09f5c))
* finished-board cues that don't rely on hue ([#52](https://github.com/activescott/four-in-a-row/issues/52)) ([01eec19](https://github.com/activescott/four-in-a-row/commit/01eec192ef22de6256fe4b9cdf06fc8722fc2ac7))
* home page links to sign-in ([#56](https://github.com/activescott/four-in-a-row/issues/56)) ([394e798](https://github.com/activescott/four-in-a-row/commit/394e798c8cd80fa2d16eee7553005462aff1149e))
* log SMTP relay errors ([#51](https://github.com/activescott/four-in-a-row/issues/51)) ([fe592fe](https://github.com/activescott/four-in-a-row/commit/fe592feae9969b5ced7abcd8fb52558789351ab1))
* upgrade to @activescott/auth 6 so passkey options are rate-limited ([#37](https://github.com/activescott/four-in-a-row/issues/37)) ([25b8326](https://github.com/activescott/four-in-a-row/commit/25b832604991e9a3613eae5f02b4776f7ecace5d))

## 0.1.0 (2026-11-15)


### Features

* add container image, release-please and GHCR publish ([#21](https://github.com/activescott/four-in-a-row/issues/21)) ([f904c1e](https://github.com/activescott/four-in-a-row/commit/f904c1e304737732d7858541d8d5ccc6d5c35800))
* add email link and passkey sign-in ([#16](https://github.com/activescott/four-in-a-row/issues/16)) ([9d8965c](https://github.com/activescott/four-in-a-row/commit/9d8965cb620be8697f94ffc89cafd4db01b0b622))
* add four-in-a-row rules module ([#9](https://github.com/activescott/four-in-a-row/issues/9)) ([9f31007](https://github.com/activescott/four-in-a-row/commit/9f31007322d584916229a2d4a71e7cbbc6e2a166))
* add game list, board page, moves and rematch ([#30](https://github.com/activescott/four-in-a-row/issues/30)) ([edd56e6](https://github.com/activescott/four-in-a-row/commit/edd56e6f2f77f984c028eef8a8e25f10d2d30bad))
* add Prisma schema, PGlite test database, health routes and logging ([#12](https://github.com/activescott/four-in-a-row/issues/12)) ([bd35708](https://github.com/activescott/four-in-a-row/commit/bd35708cfd523b2205388cae75d8b3da327bcd9a))
* make the game list and board easier to read and tap on a phone ([#33](https://github.com/activescott/four-in-a-row/issues/33)) ([dda93ad](https://github.com/activescott/four-in-a-row/commit/dda93ad703270674b598b8a86d0f7b4e9966a000))
* scaffold React Router app with Tailwind, Vitest and CI ([#5](https://github.com/activescott/four-in-a-row/issues/5)) ([fde4758](https://github.com/activescott/four-in-a-row/commit/fde4758be4710f4fdf8ae06ce067ed914fa618e5))


### Bug Fixes

* fail auth smoke check on unreachable app and pin smoke Postgres digest ([#25](https://github.com/activescott/four-in-a-row/issues/25)) ([706bb2c](https://github.com/activescott/four-in-a-row/commit/706bb2c6e60c7254ac65ebd76c559aa1d266f991))
* start the first release at 0.1.0 ([#28](https://github.com/activescott/four-in-a-row/issues/28)) ([11d9a39](https://github.com/activescott/four-in-a-row/commit/11d9a397211549ee7b7b0eb332c8923427120249))
