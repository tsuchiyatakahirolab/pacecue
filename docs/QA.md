# PaceCue validation record

Recorded on 6 November 2026 for PaceCue 0.1.0, package ID `com.tsuchiyalab.pacecue`. The automated checks, browser checks, and official simulator runs below were completed on the build identified here. Physical G2/R1 testing has not been performed, and neither GitHub publication nor an Even Hub submission has been completed.

## Identify the checked build

| Artifact | Recorded value |
| --- | --- |
| JavaScript | `dist/assets/index-fVtNwo4P.js` |
| JavaScript SHA-256 | `51e4e803dc2946775a51225af4aef016d6499a0befc822c22a90aa7cbb047bb4` |
| Even Hub package | `release/pacecue-0.1.0.ehpk` |
| Package size | 69,425 bytes |
| Package SHA-256 | `b184030b2199f742d098a4a9dfc7512cf92059caf79d7643dcf0d117c63b93b2` |
| SDK / CLI | Even Hub SDK 0.0.16 / Even Hub CLI 0.2.0 |
| Build tools | TypeScript 7.0.2 and Vite 8.3.6; Node.js 24 or newer is required. |
| Third-party notices | The package includes `THIRD_PARTY_NOTICES.txt`. |

The English and Japanese simulator runs used the same JavaScript hash shown above. The third-party notice file was added between the two runs, so an aggregate hash of the whole served directory can differ without a JavaScript change. A later code or asset change requires a new build record and matching screenshots.

## Automated checks passed

`npm run check` completed successfully: 35 tests passed, TypeScript reported no errors, and Vite produced the production build. The suite contains 19 calculation/state tests and 16 glasses-adapter/storage tests. Test sources are [core.test.ts](../tests/core.test.ts) and [glasses.test.ts](../tests/glasses.test.ts).

| Area | Coverage in the passing tests |
| --- | --- |
| Time allocation | Normal and compressed plans, required minimums, infeasible deadlines, optional-step suggestions, and stable active-step countdowns are checked. |
| Session state | Explicit completion and skipping, pause/resume, elapsed wall time, clock rollback, deadline changes, validation, and snapshot restoration are checked. |
| Local persistence | Browser/native precedence, delayed reads, ordered writes, write timeouts, invalid saved state, and foreground/background snapshot handling are checked. |
| Glasses input and display | System/container events, contextual-menu actions, acknowledged display state before a new action, countdown redraws, and exit/cancellation redraw handling are checked. |

The glasses-adapter tests use a simulated bridge. Their results establish behavior under the supplied events and responses; they do not measure Bluetooth reliability, firmware behavior, or physical gesture recognition.

## Browser flows were checked

The Japanese interface was used to start a routine, pause it, and reload the page to verify restoration. A short finish-time scenario displayed the overrun, and an optional step was skipped and then restored with Undo. After the mobile layout correction, a viewport width of 375 pixels had a document scroll width of 375 pixels, with no horizontal overflow in the checked view.

These observations concern the browser interface and its preview. They do not establish the native text layout or locked-phone behavior. JSON export also offers selectable text and import accepts pasted JSON, so users have a transfer method when the host WebView cannot download a file; availability of native file downloads was not established by these browser checks.

## The official simulator exercised both languages

Official Even Hub Simulator 0.9.5 ran the production JavaScript in English and Japanese. It loaded the built assets over local HTTP; it did not install the `.ehpk` package. The [capture record](screenshots/CAPTURE.md) identifies 15 selected raw RGBA images at 576 × 288 pixels, with the images and their hash manifest in the same directory.

| Language | Observed flow and result |
| --- | --- |
| English | The routine started; swipes showed the next-step and timing views; contextual-menu pause/resume preserved progress; an explicit completion advanced step 1 to step 2; an attempt to skip a required step was refused. |
| English exit | Double tap cleared the simulator framebuffer without subsequent display writes or app errors in the recorded run. The simulator did not present the physical device's confirmation dialog. |
| Japanese | Ready, running, next-step, timing, paused, and menu views rendered Japanese text within the checked layouts. Steps 1 and 2 were explicitly completed, optional step 3 was skipped to reach step 4, and the final completion screen appeared. |

The contextual menu was opened through the simulator's `context_menu` action. The physical tap-then-hold sequence was not tested. The raw captures contain green glyphs on a transparent background; inspection of the alpha channel confirmed that the Japanese post-skip frame included its gesture hint and both footer lines. A viewer's treatment of transparency can change how these captures appear.

## Device checks and publication remain pending

No phone model, mobile operating system, Even App version, G2 firmware, or R1 firmware is recorded as physically tested. The SDK's Even App 2.2.10 installation floor is not a tested compatibility claim. The [submission guide](SUBMISSION.md) lists the remaining beta-install, cold-launch, locked-phone, gesture, reconnect, exit, and first-party-app restart checks, including at least five minutes with the phone locked.

GitHub publication and Even Hub upload/review require login to the relevant accounts. The intended repository remains `tsuchiyatakahirolab/pacecue`; this record does not claim that a repository, store listing, or review submission is public. Update this document only with observed results from the identified build.
