# Changelog

## [1.0.1](https://github.com/sebastian-software/offcourse/compare/v1.0.0...v1.0.1) (2025-12-22)

### Bug Fixes

* use separate tsconfig.build.json for production build ([86e60c9](https://github.com/sebastian-software/offcourse/commit/86e60c9ac410e3eda446bf07d77cd27009f73817))

## 1.0.0 (2025-12-22)

### ⚠ BREAKING CHANGES

* The 'enrich' command for transcribing videos is no longer available

### Features

* add --resume flag and fix HLS URL handling in downloaders ([163055b](https://github.com/sebastian-software/offcourse/commit/163055b343345aa60bf3babd1b4bb33443d61616))
* add detailed error reporting and retry logic for Loom downloads ([177e92d](https://github.com/sebastian-software/offcourse/commit/177e92d5b5a30d959b6582327fb16d6337916ea1))
* add fast mode to skip images, fonts, CSS during scraping ([bc7a128](https://github.com/sebastian-software/offcourse/commit/bc7a12836470b914bd1b515ab04fda5a5c6e705b))
* add HighLevel (GoHighLevel) course scraper support ([04c15f8](https://github.com/sebastian-software/offcourse/commit/04c15f832381d3fbfde82e3f0847bf32f7e590c2))
* add network interception fallback for video URL capture ([fc36f6d](https://github.com/sebastian-software/offcourse/commit/fc36f6d03e5d17f681114fea791454453c5e819f))
* add OpenRouter integration for transcript polishing ([22487f2](https://github.com/sebastian-software/offcourse/commit/22487f2300bc1b9ac1b5be98db695094cca4bf54))
* add tsx for dev, detect locked lessons ([809c9fd](https://github.com/sebastian-software/offcourse/commit/809c9fdd6ae9a06e2fa038d020bdff18f275505c))
* add video transcription with Whisper ([06f9edd](https://github.com/sebastian-software/offcourse/commit/06f9eddf56c4181e4d7530c7a39ca23c25d1a0f0))
* add video type prefix [LOOM], [VIMEO] etc. to output ([bba70e7](https://github.com/sebastian-software/offcourse/commit/bba70e7581c39b9fd3e9934496cd2b50106418c6))
* add Vimeo video download support ([64ecde7](https://github.com/sebastian-software/offcourse/commit/64ecde76081749ff232732493ede602e7013be44))
* add Zod schemas for API response validation ([1fec40f](https://github.com/sebastian-software/offcourse/commit/1fec40f49a0bd6900b46eeab5d95cbf6381e01ca))
* beautiful multi-progress bars for parallel downloads ([cfe6e01](https://github.com/sebastian-software/offcourse/commit/cfe6e012eb70d283475e8963e0be08bbf24d7501))
* **cli:** add Commander-based CLI with sync, login, inspect commands ([53b53e1](https://github.com/sebastian-software/offcourse/commit/53b53e10de11d3ceefabe16f17a3b1a50cec73c4))
* **config:** add configuration system with Zod validation ([552e5c8](https://github.com/sebastian-software/offcourse/commit/552e5c8d3bebb60d443275b8bcf8e0bec44d38df))
* detect and track locked lessons separately ([8a62c9a](https://github.com/sebastian-software/offcourse/commit/8a62c9aa860e375dee8853aeecaa244668e88fd4))
* download linked PDF and Office files from lessons ([6e838be](https://github.com/sebastian-software/offcourse/commit/6e838beabc1f4e75505cffa2712f567c39be4941))
* **downloader:** add HLS streaming support for Loom videos ([2dfcae1](https://github.com/sebastian-software/offcourse/commit/2dfcae1a746075bc68882efc26c49b21aeaf7796))
* **downloader:** add native video downloader with queue system ([8c6e236](https://github.com/sebastian-software/offcourse/commit/8c6e23620682c72fd403eb4360931ce91c4fb5ec))
* extract Vimeo URLs from running player in iframe ([ba68bbe](https://github.com/sebastian-software/offcourse/commit/ba68bbe2db305531bfcda0b8a10d4d845715603b))
* format transcripts with paragraphs ([cd16eb8](https://github.com/sebastian-software/offcourse/commit/cd16eb8d3f0205802927a0623ad124a7407dff9b))
* improve download progress display and file size reporting ([c5a548c](https://github.com/sebastian-software/offcourse/commit/c5a548c0c601c7c493a616eb44a982aee70ba56a))
* improve locked lesson detection using hasAccess from JSON ([6b2e3e8](https://github.com/sebastian-software/offcourse/commit/6b2e3e80fe8a425e032dff8179389bb0963e920f))
* improved logging for unsupported video providers ([f808169](https://github.com/sebastian-software/offcourse/commit/f808169ef88bda9006cf12955f3e0b154fdc9ae6))
* parallel downloads for faster video syncing ([95d12f2](https://github.com/sebastian-software/offcourse/commit/95d12f2071281544523bd069980c1449c47acf7e))
* progress bar for Phase 1 (course structure scanning) ([2017425](https://github.com/sebastian-software/offcourse/commit/201742583b4842ebe6f1d01a39c4280988e15ba2))
* progress bars for validation and content extraction phases ([324be59](https://github.com/sebastian-software/offcourse/commit/324be597ed04e1d04f70e4c58139b2dc65648129))
* remove AI transcription and enrich feature ([7ba6327](https://github.com/sebastian-software/offcourse/commit/7ba632753a5e08d67a653ff24452d83bd3406eb7))
* **scraper:** add Playwright-based Skool scraper ([b9b111f](https://github.com/sebastian-software/offcourse/commit/b9b111f6e22ad03c78fe14d040caeee0d510a901))
* separate summary.md and transcript.md, add module summaries ([fc49a60](https://github.com/sebastian-software/offcourse/commit/fc49a6097cf612ac3a63f6c060060febd0f6b8ed))
* SQLite state management, improved video detection, graceful shutdown ([fc001d7](https://github.com/sebastian-software/offcourse/commit/fc001d7a82705b59ed4973d66d7ca8a0406c7dd4))
* **storage:** add filesystem utilities for course output ([ef18545](https://github.com/sebastian-software/offcourse/commit/ef185453a9afc6d0ff373e8dd58ce812514d6b46))
* support domain-restricted Vimeo videos via browser context ([2b16e0c](https://github.com/sebastian-software/offcourse/commit/2b16e0c21f483ecbac3b22a9e09b5f8835367d79))
* use CDP network interception to capture video URLs from iframes ([b49a873](https://github.com/sebastian-software/offcourse/commit/b49a873a6a1f4db7285e673f80de85683f548332))
* use readable titles in summary and transcript files ([ad1377d](https://github.com/sebastian-software/offcourse/commit/ad1377d83bb07611adca439546969fb9c7fdc5b7))

### Bug Fixes

* --force flag now also resets error lessons for retry ([d20e7fb](https://github.com/sebastian-software/offcourse/commit/d20e7fb95ed98d7cd9d70d798baa888ce1cd60f5))
* --resume --retry-errors now works correctly ([bbe732d](https://github.com/sebastian-software/offcourse/commit/bbe732d36e43a421ff3faa9e81f2ccfc35841fd3))
* add autoplay=1 to embed URLs to trigger HLS fetch ([1ffa068](https://github.com/sebastian-software/offcourse/commit/1ffa068ece40553118d573b0b55ff14fecfb41f2))
* add conventional-changelog-conventionalcommits peer dependency ([84f4502](https://github.com/sebastian-software/offcourse/commit/84f45029e5a81e76ab16a5f38beae16197701664))
* add missing await to saveMarkdown call ([da6e1e7](https://github.com/sebastian-software/offcourse/commit/da6e1e7dc50de9441c7ff7fc2bb5f95ddbdbb3a9))
* capture Loom/Vimeo HLS by navigating to embed page ([6608bd9](https://github.com/sebastian-software/offcourse/commit/6608bd9f9eee6107912af259340fb68ce86701e0))
* clean download progress display - remove completed bars ([8334894](https://github.com/sebastian-software/offcourse/commit/83348940a44859dc3cd915c8415d473829f3d2d0))
* extract full iframe URLs with auth params for Vimeo ([e8fcec3](https://github.com/sebastian-software/offcourse/commit/e8fcec308c3208ba2fd1a47b012926d77d199acf))
* formatting ([4491c00](https://github.com/sebastian-software/offcourse/commit/4491c00ed610997b55314ed4d456e42325de5f3f))
* handle direct HLS URLs in Loom downloader ([974b7d6](https://github.com/sebastian-software/offcourse/commit/974b7d6e7024f2f711abd3be815f3fee64bd4b10))
* **highlevel:** correctly parse product API response for course name ([697ab07](https://github.com/sebastian-software/offcourse/commit/697ab07575e61e6cd85481743c79a2f1ca74cbfb))
* **highlevel:** fix video detection and default to headless mode ([e4dcf51](https://github.com/sebastian-software/offcourse/commit/e4dcf513b0b81ddfdfec9539ae4fa8ea1f0bb0ed))
* migrate to Zod 4 API for url and datetime validation ([7519b2c](https://github.com/sebastian-software/offcourse/commit/7519b2c3f5155a938d2ec55e8a5c7e70c371659b))
* mute videos during extraction to avoid audio output ([9150dc0](https://github.com/sebastian-software/offcourse/commit/9150dc09cac1e7c70eb9a9dd257a9e4f6fd924b9))
* mute videos during extraction to avoid audio output ([ee43c1c](https://github.com/sebastian-software/offcourse/commit/ee43c1c18c138aa014bdd913db871593adcd0dda))
* **navigator:** correctly handle module URLs vs classroom URLs ([a0e8763](https://github.com/sebastian-software/offcourse/commit/a0e8763c982a65ba7a38d59c9571dbeee577ac3f))
* prefix unused parameter with underscore in queue test ([076f9c4](https://github.com/sebastian-software/offcourse/commit/076f9c4f1906358075d4061c81b31aa1b579b8da))
* resolve lint errors in syncHighLevel.ts ([4af50d5](https://github.com/sebastian-software/offcourse/commit/4af50d5615ab260de7778e2248cf3fb0bedda851))
* simplify release-it preset config for v10 compatibility ([9f9748f](https://github.com/sebastian-software/offcourse/commit/9f9748f829f1a92b9c397d5ff4ab690ac044f8f7))
* use Playwright request API for Vimeo (avoids CORS) ([09a2386](https://github.com/sebastian-software/offcourse/commit/09a23867115bded76521e27e0afbda76970b50d2))
* use response listener instead of route interception ([cb63eee](https://github.com/sebastian-software/offcourse/commit/cb63eeeeb2d2e13f3d0cba22ed702b35c1b88525))
* use URL slug for output directory name ([804e4fb](https://github.com/sebastian-software/offcourse/commit/804e4fb9d99615feccf6973b1fc603f02336146a))
* version ([d17bbc7](https://github.com/sebastian-software/offcourse/commit/d17bbc7497e660634262af2d8047f96781ff4ac2))

### Performance Improvements

* reduce wait times and improve content extraction ([e306be2](https://github.com/sebastian-software/offcourse/commit/e306be27d8d021a273801c0f5739639cab3599f7))

All notable changes to this project will be documented in this file.

This changelog is automatically generated based on [Conventional Commits](https://www.conventionalcommits.org/).
