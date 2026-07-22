# Changelog

## [1.5.0](https://github.com/sebastian-software/offcourse/compare/v1.4.0...v1.5.0) (2026-07-22)

### Features

- add Piccalilli course support ([4657304](https://github.com/sebastian-software/offcourse/commit/4657304f49db88f21d1e1738741a99ec6f993959))
- support Josh Comeau courses via unified sync ([#39](https://github.com/sebastian-software/offcourse/issues/39)) ([97056bd](https://github.com/sebastian-software/offcourse/commit/97056bd96cbdacf39b9633e747b2d92f69bd109f))
- unify course sync state across platforms ([#69](https://github.com/sebastian-software/offcourse/issues/69)) ([1530dee](https://github.com/sebastian-software/offcourse/commit/1530dee9fe660dd983a9cabc3f3c75f4970e1bb4)), closes [#21](https://github.com/sebastian-software/offcourse/issues/21)

### Bug Fixes

- accept duplicate HLS rendition names ([#75](https://github.com/sebastian-software/offcourse/issues/75)) ([c007c8a](https://github.com/sebastian-software/offcourse/commit/c007c8a29f24940e1cd8597ae134e85a6fe9ebef))
- avoid self-merging Loom video as audio ([0377ca5](https://github.com/sebastian-software/offcourse/commit/0377ca5d5ae9c0f6371b10dde3bdf9cfe01466bd)), closes [#95](https://github.com/sebastian-software/offcourse/issues/95)
- clean up shared state follow-ups ([#98](https://github.com/sebastian-software/offcourse/issues/98)) ([4163a98](https://github.com/sebastian-software/offcourse/commit/4163a98aa92351e17fd01a0ca9992fb647d7ed12))
- **deps:** update actions/setup-node action to v7 ([c06aca0](https://github.com/sebastian-software/offcourse/commit/c06aca0ccef43956bc3f575650fd0a609eb99956))
- **deps:** update codecov/codecov-action action to v7 ([8bb0401](https://github.com/sebastian-software/offcourse/commit/8bb0401c85f41b1209261f06498353fdab022b2e))
- **deps:** update commitlint monorepo to v21.2.1 ([d6bb7a3](https://github.com/sebastian-software/offcourse/commit/d6bb7a3d0fd59ff71c2b3db19e327da3115c28ee))
- **deps:** update dependency ast-v8-to-istanbul to v1.0.5 ([0ef0c9c](https://github.com/sebastian-software/offcourse/commit/0ef0c9c72db9d35765cff08f6e7a0671bc7fcf78))
- **deps:** update dependency execa to v10 ([84eed00](https://github.com/sebastian-software/offcourse/commit/84eed009a8e9c4578a9d261895e056f377083b48))
- **deps:** update dependency lint-staged to v17.1.0 ([#76](https://github.com/sebastian-software/offcourse/issues/76)) ([181a7a9](https://github.com/sebastian-software/offcourse/commit/181a7a9145a1c2b4843a3d6d5f07820a524860d3))
- **deps:** update dependency node to v24 ([e83c18a](https://github.com/sebastian-software/offcourse/commit/e83c18a50eeba1e57555b6bbd46483d0b54d4a38))
- **deps:** update pnpm to v11.13.1 ([6b3707e](https://github.com/sebastian-software/offcourse/commit/6b3707e2189ca0635369b19d5d63c3982a78b2b2))
- **deps:** update pnpm to v11.15.0 ([#77](https://github.com/sebastian-software/offcourse/issues/77)) ([818502d](https://github.com/sebastian-software/offcourse/commit/818502d0e6d3527241910be19b40d75733accedd))
- download complete LearningSuite videos ([bf650cc](https://github.com/sebastian-software/offcourse/commit/bf650cc7cfa815bdb02a85ecc0e33a010c795593))
- ensure segment paths are relative in concatSegments function ([#1](https://github.com/sebastian-software/offcourse/issues/1)) ([6dbc09a](https://github.com/sebastian-software/offcourse/commit/6dbc09a849edc196374c05857045a1f1c1f5301d))
- fail incomplete HLS segment downloads ([#44](https://github.com/sebastian-software/offcourse/issues/44)) ([5855339](https://github.com/sebastian-software/offcourse/commit/585533977c68ad27416fc369e74771223c083230))
- fall back to GET when HLS HEAD is rejected ([9a14de1](https://github.com/sebastian-software/offcourse/commit/9a14de1e4b5d00358b704ae4b749631fa998f12f)), closes [#96](https://github.com/sebastian-software/offcourse/issues/96)
- format Renovate configuration ([#46](https://github.com/sebastian-software/offcourse/issues/46)) ([d8abb5d](https://github.com/sebastian-software/offcourse/commit/d8abb5d6cd8612017013828850dc6794c8ead8af))
- handle incomplete Vimeo configs ([1d37011](https://github.com/sebastian-software/offcourse/commit/1d3701193f25435c9df4b04b06a91c1c7c811bf9))
- handle progressive output stream failures ([#48](https://github.com/sebastian-software/offcourse/issues/48)) ([8cdcd6a](https://github.com/sebastian-software/offcourse/commit/8cdcd6afdc5412f3ed2cffa929b3f421f2e9b135))
- handle unsupported Skool sync options ([2d25477](https://github.com/sebastian-software/offcourse/commit/2d25477bf233fcdfce29efaefe989033fe2d3891)), closes [#90](https://github.com/sebastian-software/offcourse/issues/90)
- harden course database migrations ([#63](https://github.com/sebastian-software/offcourse/issues/63)) ([05234c4](https://github.com/sebastian-software/offcourse/commit/05234c48c9af49c0640ce2cde25ee060a283b641))
- harden download failures and timeouts ([a4fc545](https://github.com/sebastian-software/offcourse/commit/a4fc54579f1f24f484046aebb2c6d32548ede352)), closes [#93](https://github.com/sebastian-software/offcourse/issues/93)
- harden downloader HTTP boundaries ([#61](https://github.com/sebastian-software/offcourse/issues/61)) ([a737fdf](https://github.com/sebastian-software/offcourse/commit/a737fdfabb03407a41d8986b656f5ec5fef74bbf))
- harden LearningSuite module scanning ([9945eef](https://github.com/sebastian-software/offcourse/commit/9945eefbc92414c318f7d55237c9b58451662dcb)), closes [#85](https://github.com/sebastian-software/offcourse/issues/85)
- ignore local worktrees in checks ([580ed71](https://github.com/sebastian-software/offcourse/commit/580ed7184d5ecffe77666780f0b5d5723d1ebe85))
- improve scraper diagnostics and title cleanup ([#54](https://github.com/sebastian-software/offcourse/issues/54)) ([b0da40b](https://github.com/sebastian-software/offcourse/commit/b0da40baeb3d73370a29c586a8eef74c50b028cf))
- isolate LearningSuite HLS renditions ([#49](https://github.com/sebastian-software/offcourse/issues/49)) ([8216379](https://github.com/sebastian-software/offcourse/commit/8216379f294ab3055d1eace4d8f416edd157b7a2))
- keep interactive Josh login on current page ([8bff05b](https://github.com/sebastian-software/offcourse/commit/8bff05bae595a5689685076756d8cbdfde726643)), closes [#89](https://github.com/sebastian-software/offcourse/issues/89)
- **loom:** clean up downloads and capture sessions ([#52](https://github.com/sebastian-software/offcourse/issues/52)) ([0857a08](https://github.com/sebastian-software/offcourse/commit/0857a083bed2bfad9109f635de8e9b18fe11fed9))
- make CLI shutdown interruptible ([5990f77](https://github.com/sebastian-software/offcourse/commit/5990f77f1a8abe4077fd251de4f005dfe1038d84))
- normalize Skool URLs before validation ([#50](https://github.com/sebastian-software/offcourse/issues/50)) ([b1b6c6c](https://github.com/sebastian-software/offcourse/commit/b1b6c6c7b70083f2b9a148e09a57b1c256101db5))
- polish Josh Comeau extraction and downloads ([79e38bf](https://github.com/sebastian-software/offcourse/commit/79e38bfd1f1fb2b29a65887b870da1bb44e36cce)), closes [#97](https://github.com/sebastian-software/offcourse/issues/97)
- preserve LearningSuite modules and lessons ([#51](https://github.com/sebastian-software/offcourse/issues/51)) ([56c0ff0](https://github.com/sebastian-software/offcourse/commit/56c0ff044d0c5fe134e91dc36baaa3f2f1dd21fb))
- preserve retry errors during shutdown ([300625c](https://github.com/sebastian-software/offcourse/commit/300625cac3034784e7b704fc8f3cc8bb027f2660)), closes [#86](https://github.com/sebastian-software/offcourse/issues/86)
- preserve signed HLS variant queries ([87bb033](https://github.com/sebastian-software/offcourse/commit/87bb0337ca8d6f0b8ecc34985143e51cd193f96d))
- preserve Vimeo HLS audio and signed URLs ([#53](https://github.com/sebastian-software/offcourse/issues/53)) ([43238db](https://github.com/sebastian-software/offcourse/commit/43238dbe0e175c29e28d48f7af7b0f72f262b377))
- propagate progressive stream failures ([#43](https://github.com/sebastian-software/offcourse/issues/43)) ([c1b53ba](https://github.com/sebastian-software/offcourse/commit/c1b53bafa6d045a51edf3e5e26ec5583c5dc0d5c))
- protect stored session credentials ([#41](https://github.com/sebastian-software/offcourse/issues/41)) ([57ed415](https://github.com/sebastian-software/offcourse/commit/57ed415a2b132019a8dbd8a60116ceb6001f403b))
- publish attachments atomically ([6238a37](https://github.com/sebastian-software/offcourse/commit/6238a376311e3e19df82bcf9d3d3194951c98f12))
- publish ffmpeg output atomically ([#47](https://github.com/sebastian-software/offcourse/issues/47)) ([484acc2](https://github.com/sebastian-software/offcourse/commit/484acc22e1a647addb31933172156911efff8c22))
- redact signed download URLs ([#42](https://github.com/sebastian-software/offcourse/issues/42)) ([5cd3248](https://github.com/sebastian-software/offcourse/commit/5cd3248bc8417da94d5dbc7e710302277cac069a))
- reject unsupported sync options and URLs ([#55](https://github.com/sebastian-software/offcourse/issues/55)) ([b6e2ad9](https://github.com/sebastian-software/offcourse/commit/b6e2ad95b429cb5f3efda13b69b603c0e0e84122))
- report complete source coverage ([#56](https://github.com/sebastian-software/offcourse/issues/56)) ([077a916](https://github.com/sebastian-software/offcourse/commit/077a916af82c9647bf841f3837d565b429c6363f))
- report coverage without provider workaround ([#57](https://github.com/sebastian-software/offcourse/issues/57)) ([92cc64b](https://github.com/sebastian-software/offcourse/commit/92cc64b563aa293134510ea0bbeb6068ce49eaa0))
- resume validated native lessons ([73fb4dd](https://github.com/sebastian-software/offcourse/commit/73fb4dd6dea779d8b8dc68c2ce7c950479a532b5))
- sanitize attachment download paths ([#40](https://github.com/sebastian-software/offcourse/issues/40)) ([b92983b](https://github.com/sebastian-software/offcourse/commit/b92983b10527aabf722350a5e686273cb37cf682))
- stabilize Josh Comeau Vimeo extraction ([4c3c580](https://github.com/sebastian-software/offcourse/commit/4c3c5806ff43a7f33ff60085d8d9ea9b5a59174f))
- stabilize Piccalilli OTP login ([d3e3ac2](https://github.com/sebastian-software/offcourse/commit/d3e3ac25bfdb04830a8f1e97382fd199b66d2e05))
- support LearningSuite login URLs ([65110c9](https://github.com/sebastian-software/offcourse/commit/65110c9afc865c4fe797842d9516c6d981cc5d54))
- update Skool login and course extraction ([87982e1](https://github.com/sebastian-software/offcourse/commit/87982e17a848ef7556b71e163d8f755ff5d7da50))
- validate pending Skool lessons ([3c2d384](https://github.com/sebastian-software/offcourse/commit/3c2d384134fce72d9ef3f12be58a945421380c56))
- wait for Josh Comeau hydration assets ([517d671](https://github.com/sebastian-software/offcourse/commit/517d671429ef8d566630cc4e7bceb133b2e96b1e)), closes [#87](https://github.com/sebastian-software/offcourse/issues/87)

## [1.4.0](https://github.com/sebastian-software/offcourse/compare/v1.3.0...v1.4.0) (2025-12-28)

### Features

- add spinner feedback during course structure scanning ([3e9bc2d](https://github.com/sebastian-software/offcourse/commit/3e9bc2d7b76970c7917c1ce5ec5e818bc51afe1f))
- parallel course structure scanning ([97a5fe4](https://github.com/sebastian-software/offcourse/commit/97a5fe4178a52bb53ad514855ebe48ab3cea1a4b))

## [1.3.0](https://github.com/sebastian-software/offcourse/compare/v1.2.2...v1.3.0) (2025-12-27)

### Features

- add integration test infrastructure with combined Codecov coverage ([5113cc6](https://github.com/sebastian-software/offcourse/commit/5113cc62594ab0da2b89d282362587b7a3403189))
- add self-hosted HLS test stream for integration tests ([5c56175](https://github.com/sebastian-software/offcourse/commit/5c56175e654a7a71e98557d312078bd21df74479))

### Bug Fixes

- **cli:** ensure browser always closes and process exits cleanly ([fab14ec](https://github.com/sebastian-software/offcourse/commit/fab14ecfc69c48bc4f234f5a7f01eb8bce602e2a))
- codecov config - don't require both flags simultaneously ([8a04c6a](https://github.com/sebastian-software/offcourse/commit/8a04c6ab302f91ad890d3ba10511e8c651ad0cd8))
- **downloader:** use unique temp directories for parallel segment downloads ([cec6c37](https://github.com/sebastian-software/offcourse/commit/cec6c37f2edd9d9adef782bcc20395354bf8a07a))
- handle untildify behavior in expandPath tests ([ee4e192](https://github.com/sebastian-software/offcourse/commit/ee4e19239ef153d32cef3431c7a92eb57cd1a856))
- **learningsuite:** auto-dismiss MUI modal dialogs before interactions ([b80959c](https://github.com/sebastian-software/offcourse/commit/b80959c6f5156c3785f4bd64fecdd9b2151b30f0))
- **learningsuite:** capture all HLS segments by seeking through video ([822db9a](https://github.com/sebastian-software/offcourse/commit/822db9af83beefbd92773b7eb2afd84aef35b3f3))
- make fileSystem tests cross-platform compatible ([8f64516](https://github.com/sebastian-software/offcourse/commit/8f64516655c4d7808089bff72fb2804c067b3a8f))
- make path tests cross-platform compatible ([11c81b6](https://github.com/sebastian-software/offcourse/commit/11c81b694463f183497e3e314b71d2aa855deccc))
- optimize integration tests for speed ([0bd826c](https://github.com/sebastian-software/offcourse/commit/0bd826c2df938e3194ee87251599446df4ec5034))
- skip slow HLS download test by default in integration tests ([d724434](https://github.com/sebastian-software/offcourse/commit/d724434aba091bb22507bd3280968674311a41d9))
- update vitest config for v4 (remove deprecated poolOptions) ([f603fcc](https://github.com/sebastian-software/offcourse/commit/f603fcc4ea5848c10e88277f2d4b57b1ba60afdf))
- use pnpm instead of npm in CI workflow ([776b67f](https://github.com/sebastian-software/offcourse/commit/776b67fbd65787871a81d02b3f32c3d92ca070a5))

## [1.2.2](https://github.com/sebastian-software/offcourse/compare/v1.2.1...v1.2.2) (2025-12-23)

### Bug Fixes

- **downloader:** add -nostdin to ffmpeg to prevent hanging ([3dd95eb](https://github.com/sebastian-software/offcourse/commit/3dd95ebfb4ed273083574d1aac2e94dae9a624b8))
- **learningsuite:** add auth token (APIKEY) to video downloads ([4f4f963](https://github.com/sebastian-software/offcourse/commit/4f4f963ec5d1d190a155d249d4f18825b7d0efb1))
- **learningsuite:** capture API proxy URLs and follow redirects ([6301013](https://github.com/sebastian-software/offcourse/commit/630101348324d636e673488a9af850505de6bc65))
- **learningsuite:** download encrypted HLS videos via segment capture ([d0c0f0a](https://github.com/sebastian-software/offcourse/commit/d0c0f0a9c4b34fef10511445e0395aae6ff2f83f))

## [1.2.1](https://github.com/sebastian-software/offcourse/compare/v1.2.0...v1.2.1) (2025-12-23)

### Bug Fixes

- **learningsuite:** filter out API proxy URLs, capture real CDN URLs ([e281413](https://github.com/sebastian-software/offcourse/commit/e281413d7d1a50baf7f896c6f39ce82656b47e73))

## [1.2.0](https://github.com/sebastian-software/offcourse/compare/v1.1.0...v1.2.0) (2025-12-23)

### Features

- add GitHub Pages homepage with logo ([a121038](https://github.com/sebastian-software/offcourse/commit/a121038e455b1d2d66c3c98bcef7ee3920f908a0))

### Bug Fixes

- **hls:** improve video URL detection and error handling ([7b9b0cc](https://github.com/sebastian-software/offcourse/commit/7b9b0cc8b9c875bf0575ef55eb925005a819a5e0))

## [1.1.0](https://github.com/sebastian-software/offcourse/compare/v1.0.1...v1.1.0) (2025-12-23)

### Features

- add LearningSuite platform support ([d5c2af5](https://github.com/sebastian-software/offcourse/commit/d5c2af5281fbdf8d4e909f6f69a5ecf966394fcb))
- complete command now auto-detects platform ([5a11776](https://github.com/sebastian-software/offcourse/commit/5a11776a83ae2c53fe130c76e7c0f5faed1da6d1))
- **complete:** iterative approach to unlock all content ([a3d5207](https://github.com/sebastian-software/offcourse/commit/a3d5207469ab2ae051980e13b1048b6af211b52e))
- **learningsuite:** add --auto-complete option to batch complete lessons ([df86ad2](https://github.com/sebastian-software/offcourse/commit/df86ad2bcb33247b12b9b0ad62aff13360e611cf))
- **learningsuite:** detect locked lessons and add auto-complete option ([05235bd](https://github.com/sebastian-software/offcourse/commit/05235bd8a47102750ffc390cbf597ebeec3037fd))

### Bug Fixes

- **complete:** avoid stale element references when clicking modules ([73ccd35](https://github.com/sebastian-software/offcourse/commit/73ccd3518b774825bf361462a324745ffd98a661))
- **complete:** iterate through all modules and lessons systematically ([6aac791](https://github.com/sebastian-software/offcourse/commit/6aac79181e3a8774c39ca4b5ae8c10389a6037fe))
- **complete:** mark incomplete lessons, not just unlock locked ones ([ff6c5cb](https://github.com/sebastian-software/offcourse/commit/ff6c5cb9bd889c8eb5e70b6c9db1d64ac9e81d7d))
- **learningsuite:** --auto-complete now exits after completing lessons ([78852d9](https://github.com/sebastian-software/offcourse/commit/78852d923e796ef4b901eb16b78928e5e8532aa8))
- **learningsuite:** add Origin/Referer headers to HLS downloads ([d1157b2](https://github.com/sebastian-software/offcourse/commit/d1157b2defc92d0ba1d1c3e9074d99a38572a1b1))
- **learningsuite:** improve video and attachment extraction ([a0da5b9](https://github.com/sebastian-software/offcourse/commit/a0da5b9814a779cf25790ca94ca11184c24fdfde))
- **learningsuite:** improve video detection with play button trigger ([e750f6e](https://github.com/sebastian-software/offcourse/commit/e750f6eadfe7fdcac10e4f60bffb5156f41e4d11))
- **learningsuite:** pass session cookies to HLS video downloads ([09b2006](https://github.com/sebastian-software/offcourse/commit/09b200636be75663456cb59f9d64c38a2077d7cc))
- **learningsuite:** properly extract lesson title and text content ([b57fcc6](https://github.com/sebastian-software/offcourse/commit/b57fcc607e9834c32e0c4c988967e3e165296493))
- **learningsuite:** properly extract modules and lessons from course pages ([9b1d5dd](https://github.com/sebastian-software/offcourse/commit/9b1d5ddf1f3ad8fe5bd2644b943ce0167980ba89))
- **learningsuite:** remove redundant video URL from markdown ([146d6f6](https://github.com/sebastian-software/offcourse/commit/146d6f6ede5a5c705db7e175e99f73798a6c0829))
- **learningsuite:** suppress GraphQL errors, use DOM-based extraction ([96aad94](https://github.com/sebastian-software/offcourse/commit/96aad94357d45796671c445864d10c1deb4ddb45))
- **learningsuite:** use correct referer URL for video downloads ([31f3031](https://github.com/sebastian-software/offcourse/commit/31f30313a112d9862ce28d2efb9fd76d3097e1ba))
- resolve ESLint errors ([4fd34cc](https://github.com/sebastian-software/offcourse/commit/4fd34cc239a7d1dda920680111e59fc5aac3ca1f))
- show correct phase message when --skip-content is used ([b6b7e82](https://github.com/sebastian-software/offcourse/commit/b6b7e82e56c2ae169611ffc9b4300c5187768531))

## [1.0.1](https://github.com/sebastian-software/offcourse/compare/v1.0.0...v1.0.1) (2025-12-22)

### Bug Fixes

- use separate tsconfig.build.json for production build ([86e60c9](https://github.com/sebastian-software/offcourse/commit/86e60c9ac410e3eda446bf07d77cd27009f73817))

## 1.0.0 (2025-12-22)

### ⚠ BREAKING CHANGES

- The 'enrich' command for transcribing videos is no longer available

### Features

- add --resume flag and fix HLS URL handling in downloaders ([163055b](https://github.com/sebastian-software/offcourse/commit/163055b343345aa60bf3babd1b4bb33443d61616))
- add detailed error reporting and retry logic for Loom downloads ([177e92d](https://github.com/sebastian-software/offcourse/commit/177e92d5b5a30d959b6582327fb16d6337916ea1))
- add fast mode to skip images, fonts, CSS during scraping ([bc7a128](https://github.com/sebastian-software/offcourse/commit/bc7a12836470b914bd1b515ab04fda5a5c6e705b))
- add HighLevel (GoHighLevel) course scraper support ([04c15f8](https://github.com/sebastian-software/offcourse/commit/04c15f832381d3fbfde82e3f0847bf32f7e590c2))
- add network interception fallback for video URL capture ([fc36f6d](https://github.com/sebastian-software/offcourse/commit/fc36f6d03e5d17f681114fea791454453c5e819f))
- add OpenRouter integration for transcript polishing ([22487f2](https://github.com/sebastian-software/offcourse/commit/22487f2300bc1b9ac1b5be98db695094cca4bf54))
- add tsx for dev, detect locked lessons ([809c9fd](https://github.com/sebastian-software/offcourse/commit/809c9fdd6ae9a06e2fa038d020bdff18f275505c))
- add video transcription with Whisper ([06f9edd](https://github.com/sebastian-software/offcourse/commit/06f9eddf56c4181e4d7530c7a39ca23c25d1a0f0))
- add video type prefix [LOOM], [VIMEO] etc. to output ([bba70e7](https://github.com/sebastian-software/offcourse/commit/bba70e7581c39b9fd3e9934496cd2b50106418c6))
- add Vimeo video download support ([64ecde7](https://github.com/sebastian-software/offcourse/commit/64ecde76081749ff232732493ede602e7013be44))
- add Zod schemas for API response validation ([1fec40f](https://github.com/sebastian-software/offcourse/commit/1fec40f49a0bd6900b46eeab5d95cbf6381e01ca))
- beautiful multi-progress bars for parallel downloads ([cfe6e01](https://github.com/sebastian-software/offcourse/commit/cfe6e012eb70d283475e8963e0be08bbf24d7501))
- **cli:** add Commander-based CLI with sync, login, inspect commands ([53b53e1](https://github.com/sebastian-software/offcourse/commit/53b53e10de11d3ceefabe16f17a3b1a50cec73c4))
- **config:** add configuration system with Zod validation ([552e5c8](https://github.com/sebastian-software/offcourse/commit/552e5c8d3bebb60d443275b8bcf8e0bec44d38df))
- detect and track locked lessons separately ([8a62c9a](https://github.com/sebastian-software/offcourse/commit/8a62c9aa860e375dee8853aeecaa244668e88fd4))
- download linked PDF and Office files from lessons ([6e838be](https://github.com/sebastian-software/offcourse/commit/6e838beabc1f4e75505cffa2712f567c39be4941))
- **downloader:** add HLS streaming support for Loom videos ([2dfcae1](https://github.com/sebastian-software/offcourse/commit/2dfcae1a746075bc68882efc26c49b21aeaf7796))
- **downloader:** add native video downloader with queue system ([8c6e236](https://github.com/sebastian-software/offcourse/commit/8c6e23620682c72fd403eb4360931ce91c4fb5ec))
- extract Vimeo URLs from running player in iframe ([ba68bbe](https://github.com/sebastian-software/offcourse/commit/ba68bbe2db305531bfcda0b8a10d4d845715603b))
- format transcripts with paragraphs ([cd16eb8](https://github.com/sebastian-software/offcourse/commit/cd16eb8d3f0205802927a0623ad124a7407dff9b))
- improve download progress display and file size reporting ([c5a548c](https://github.com/sebastian-software/offcourse/commit/c5a548c0c601c7c493a616eb44a982aee70ba56a))
- improve locked lesson detection using hasAccess from JSON ([6b2e3e8](https://github.com/sebastian-software/offcourse/commit/6b2e3e80fe8a425e032dff8179389bb0963e920f))
- improved logging for unsupported video providers ([f808169](https://github.com/sebastian-software/offcourse/commit/f808169ef88bda9006cf12955f3e0b154fdc9ae6))
- parallel downloads for faster video syncing ([95d12f2](https://github.com/sebastian-software/offcourse/commit/95d12f2071281544523bd069980c1449c47acf7e))
- progress bar for Phase 1 (course structure scanning) ([2017425](https://github.com/sebastian-software/offcourse/commit/201742583b4842ebe6f1d01a39c4280988e15ba2))
- progress bars for validation and content extraction phases ([324be59](https://github.com/sebastian-software/offcourse/commit/324be597ed04e1d04f70e4c58139b2dc65648129))
- remove AI transcription and enrich feature ([7ba6327](https://github.com/sebastian-software/offcourse/commit/7ba632753a5e08d67a653ff24452d83bd3406eb7))
- **scraper:** add Playwright-based Skool scraper ([b9b111f](https://github.com/sebastian-software/offcourse/commit/b9b111f6e22ad03c78fe14d040caeee0d510a901))
- separate summary.md and transcript.md, add module summaries ([fc49a60](https://github.com/sebastian-software/offcourse/commit/fc49a6097cf612ac3a63f6c060060febd0f6b8ed))
- SQLite state management, improved video detection, graceful shutdown ([fc001d7](https://github.com/sebastian-software/offcourse/commit/fc001d7a82705b59ed4973d66d7ca8a0406c7dd4))
- **storage:** add filesystem utilities for course output ([ef18545](https://github.com/sebastian-software/offcourse/commit/ef185453a9afc6d0ff373e8dd58ce812514d6b46))
- support domain-restricted Vimeo videos via browser context ([2b16e0c](https://github.com/sebastian-software/offcourse/commit/2b16e0c21f483ecbac3b22a9e09b5f8835367d79))
- use CDP network interception to capture video URLs from iframes ([b49a873](https://github.com/sebastian-software/offcourse/commit/b49a873a6a1f4db7285e673f80de85683f548332))
- use readable titles in summary and transcript files ([ad1377d](https://github.com/sebastian-software/offcourse/commit/ad1377d83bb07611adca439546969fb9c7fdc5b7))

### Bug Fixes

- --force flag now also resets error lessons for retry ([d20e7fb](https://github.com/sebastian-software/offcourse/commit/d20e7fb95ed98d7cd9d70d798baa888ce1cd60f5))
- --resume --retry-errors now works correctly ([bbe732d](https://github.com/sebastian-software/offcourse/commit/bbe732d36e43a421ff3faa9e81f2ccfc35841fd3))
- add autoplay=1 to embed URLs to trigger HLS fetch ([1ffa068](https://github.com/sebastian-software/offcourse/commit/1ffa068ece40553118d573b0b55ff14fecfb41f2))
- add conventional-changelog-conventionalcommits peer dependency ([84f4502](https://github.com/sebastian-software/offcourse/commit/84f45029e5a81e76ab16a5f38beae16197701664))
- add missing await to saveMarkdown call ([da6e1e7](https://github.com/sebastian-software/offcourse/commit/da6e1e7dc50de9441c7ff7fc2bb5f95ddbdbb3a9))
- capture Loom/Vimeo HLS by navigating to embed page ([6608bd9](https://github.com/sebastian-software/offcourse/commit/6608bd9f9eee6107912af259340fb68ce86701e0))
- clean download progress display - remove completed bars ([8334894](https://github.com/sebastian-software/offcourse/commit/83348940a44859dc3cd915c8415d473829f3d2d0))
- extract full iframe URLs with auth params for Vimeo ([e8fcec3](https://github.com/sebastian-software/offcourse/commit/e8fcec308c3208ba2fd1a47b012926d77d199acf))
- formatting ([4491c00](https://github.com/sebastian-software/offcourse/commit/4491c00ed610997b55314ed4d456e42325de5f3f))
- handle direct HLS URLs in Loom downloader ([974b7d6](https://github.com/sebastian-software/offcourse/commit/974b7d6e7024f2f711abd3be815f3fee64bd4b10))
- **highlevel:** correctly parse product API response for course name ([697ab07](https://github.com/sebastian-software/offcourse/commit/697ab07575e61e6cd85481743c79a2f1ca74cbfb))
- **highlevel:** fix video detection and default to headless mode ([e4dcf51](https://github.com/sebastian-software/offcourse/commit/e4dcf513b0b81ddfdfec9539ae4fa8ea1f0bb0ed))
- migrate to Zod 4 API for url and datetime validation ([7519b2c](https://github.com/sebastian-software/offcourse/commit/7519b2c3f5155a938d2ec55e8a5c7e70c371659b))
- mute videos during extraction to avoid audio output ([9150dc0](https://github.com/sebastian-software/offcourse/commit/9150dc09cac1e7c70eb9a9dd257a9e4f6fd924b9))
- mute videos during extraction to avoid audio output ([ee43c1c](https://github.com/sebastian-software/offcourse/commit/ee43c1c18c138aa014bdd913db871593adcd0dda))
- **navigator:** correctly handle module URLs vs classroom URLs ([a0e8763](https://github.com/sebastian-software/offcourse/commit/a0e8763c982a65ba7a38d59c9571dbeee577ac3f))
- prefix unused parameter with underscore in queue test ([076f9c4](https://github.com/sebastian-software/offcourse/commit/076f9c4f1906358075d4061c81b31aa1b579b8da))
- resolve lint errors in syncHighLevel.ts ([4af50d5](https://github.com/sebastian-software/offcourse/commit/4af50d5615ab260de7778e2248cf3fb0bedda851))
- simplify release-it preset config for v10 compatibility ([9f9748f](https://github.com/sebastian-software/offcourse/commit/9f9748f829f1a92b9c397d5ff4ab690ac044f8f7))
- use Playwright request API for Vimeo (avoids CORS) ([09a2386](https://github.com/sebastian-software/offcourse/commit/09a23867115bded76521e27e0afbda76970b50d2))
- use response listener instead of route interception ([cb63eee](https://github.com/sebastian-software/offcourse/commit/cb63eeeeb2d2e13f3d0cba22ed702b35c1b88525))
- use URL slug for output directory name ([804e4fb](https://github.com/sebastian-software/offcourse/commit/804e4fb9d99615feccf6973b1fc603f02336146a))
- version ([d17bbc7](https://github.com/sebastian-software/offcourse/commit/d17bbc7497e660634262af2d8047f96781ff4ac2))

### Performance Improvements

- reduce wait times and improve content extraction ([e306be2](https://github.com/sebastian-software/offcourse/commit/e306be27d8d021a273801c0f5739639cab3599f7))

All notable changes to this project will be documented in this file.

This changelog is automatically generated based on [Conventional Commits](https://www.conventionalcommits.org/).
