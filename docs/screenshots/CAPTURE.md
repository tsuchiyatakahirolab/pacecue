# Official simulator captures

These PNGs were captured from PaceCue running in the official Even Hub simulator 0.9.5 on 6 November 2026. They are actual native framebuffer captures, not mockups. The app used `@evenrealities/even_hub_sdk` 0.0.16. The English run started at 12:29:52 UTC and the Japanese run at 12:31:25 UTC, with fresh, separate simulator storage for each language.

The 15 selected screenshots are unmodified RGBA PNGs at 576 × 288 pixels. Their original alpha channels are preserved. The simulator stores green RGB values even in fully transparent pixels, so an image viewer that ignores alpha may show a solid green rectangle. View these images with transparency support; do not discard alpha. Separate alpha-only images were used for inspection and are not included as native screenshots.

## Captured states

| State | English | Japanese |
| --- | --- | --- |
| Ready to start | [Ready](simulator-en-ready.png) | [Ready](simulator-ja-ready.png) |
| Current step and countdown | [Running](simulator-en-running.png) | [Running](simulator-ja-running.png) |
| Next step | [Next](simulator-en-next.png) | [Next](simulator-ja-next.png) |
| Finish-time overview | [Time](simulator-en-time.png) | [Time](simulator-ja-time.png) |
| Native context menu | [Menu](simulator-en-menu.png) | [Menu](simulator-ja-menu.png) |
| Paused session | [Paused](simulator-en-paused.png) | [Paused](simulator-ja-paused.png) |
| Required step remains after attempted skip | [Required step protected](simulator-en-required-protected.png) | — |
| Optional step explicitly skipped | — | [Step 4 after optional skip](simulator-ja-optional-skipped.png) |
| Session completed | — | [Completed](simulator-ja-complete.png) |

The native labels, Japanese glyphs, two-line gesture footer and localized menu were visually checked. The post-skip Japanese screenshot also retains the third body line and both footer lines in its original alpha data. No screenshot was retouched, recolored, resized or flattened.

## What was exercised

Both language runs tested an explicit start, swiping to the next-step and time views, opening the native context menu, pausing and resuming, and explicitly completing a step. Selecting pause or resume in the native menu did not inadvertently complete the current step. The English run attempted to skip a required step and confirmed that it remained current. The Japanese run explicitly skipped optional step 3, advanced to step 4, and then completed the session with a separate tap.

The English run also sent a double-click input. The simulator cleared its framebuffer, and PaceCue made no subsequent display writes or application-error logs. This simulator run did not show a native exit confirmation dialog or emit `SYSTEM_EXIT_EVENT`; confirmation and cancellation must still be tested on actual hardware.

There were 25 native API inputs and 21 paired captures across the two runs: 10 English pairs and 11 Japanese pairs, producing 42 original PNGs for the glasses framebuffer and companion WebView. Fifteen glasses images were selected for this directory. The captured console logs contained 188 entries and no PaceCue warnings or errors. Each run did log initial Tauri custom-protocol fetch failures followed by its `postMessage` transport fallback; native display and input operations continued successfully.

The [capture manifest](capture-manifest.json) contains the exact capture timestamps, image hashes, per-run API operations, source screenshot hashes, console warning/error entries and build hashes. A capture timestamp records completion of the paired screenshot requests, not the exact time of an individual rendered pixel.

## Build identity

Both runs loaded the same JavaScript bundle:

```text
dist/assets/index-fVtNwo4P.js
SHA-256: 51e4e803dc2946775a51225af4aef016d6499a0befc822c22a90aa7cbb047bb4
```

`THIRD_PARTY_NOTICES.txt` was added to `dist` between the English and Japanese runs. JavaScript, CSS and HTML were unchanged. This accounts for the different aggregate distribution hashes:

| Distribution | Aggregate SHA-256 |
| --- | --- |
| English run, before notices file | `a9c8c61fd1958222d61c93443d826c593a9eecc7209aa94070e1db1fdce84fae` |
| Japanese run, with notices file | `274c09e2defe8081ab98cc335d6bf82b1e303e3c489dc4ad5eceaeeae54111e1` |

The aggregate hashes were calculated by sorting all relative `dist` filenames and feeding each UTF-8 filename immediately followed by its raw file bytes into SHA-256. Excluding only `THIRD_PARTY_NOTICES.txt` from the final distribution reproduces the English aggregate hash. The build owner reports the resulting package, including notices, as 69,425 bytes with SHA-256 `b184030b2199f742d098a4a9dfc7512cf92059caf79d7643dcf0d117c63b93b2`. The simulator loaded built web assets over local HTTP; it did not install or approve that package.

## Capture method and remaining checks

The simulator ran under authenticated Xvfb on Ubuntu 24.04.3 with GTK/WebKit software rendering. No flag or environment setting to disable the WebKit sandbox was used. A private loopback HTTP server served the built app; the simulator was launched with `--automation-port 9898 --no-glow`. Inputs used the documented `POST /api/input` endpoint. Images came directly from `GET /api/screenshot/glasses` and `GET /api/screenshot/webview`, and console records from `GET /api/console`.

The API's `context_menu` action was used to open the native menu. The physical tap-plus-long-press gesture sequence was not tested. No physical Even G2 or R1 was available, so these results do not establish locked-phone operation, Bluetooth recovery, real-device persistence, battery use, actual-device Japanese rendering or the native exit confirmation flow. Those checks remain required before claiming a hardware-tested release. These captures also do not imply submission, approval or public release by Even Hub.
