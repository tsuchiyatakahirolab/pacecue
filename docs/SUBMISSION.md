# PaceCue submission guide

Prepared on 6 November 2026 for version 0.1.0. This document is a preparation and test record, not evidence that the app has been submitted or approved.

## Current status

| Item | Status |
| --- | --- |
| Source and documentation | Published in the public [GitHub repository](https://github.com/tsuchiyatakahirolab/pacecue); the initial source revision is recorded in [QA.md](QA.md). |
| Automated checks | 35 automated tests, TypeScript checking, and the Vite production build passed. See [QA.md](QA.md). |
| Package | `release/pacecue-0.1.0.ehpk` is generated with SDK 0.0.16 and includes `THIRD_PARTY_NOTICES.txt`. Its size and SHA-256 are recorded in [QA.md](QA.md). |
| Browser checks | Japanese start, pause, reload/restore, short-deadline overrun, optional skip/undo, and a 375-pixel mobile viewport were checked. See [QA.md](QA.md). |
| Official simulator | Version 0.9.5 passed the recorded English and Japanese flows using the release JavaScript. Results and simulator limits are in [QA.md](QA.md). |
| Store screenshots | Fifteen selected official simulator captures and their hashes are documented in the [capture record](screenshots/CAPTURE.md). Confirm the chosen images and current uploader limits before submission. |
| Physical G2/R1 testing | Not performed. |
| Even Hub upload and review | Not completed; authenticated developer access is required. |
| Even Hub publication | Not completed. |
| GitHub publication | Verified on 7 November 2026 (JST), public repository with default branch `main`; initial source commit [4ff62b0](https://github.com/tsuchiyatakahirolab/pacecue/commit/4ff62b02a3896e03703122b50f5060fe298c6c32). |

## Manifest and listing

| Field | Value |
| --- | --- |
| Package ID | `com.tsuchiyalab.pacecue` |
| Name | `PaceCue` |
| Version | `0.1.0` |
| Edition | `202601` |
| SDK | `0.0.16` |
| Minimum Even app | `2.2.10`, subject to inspecting the packaged manifest. |
| Entrypoint | `index.html` |
| Permissions | `[]` |
| Supported languages | `en`, `ja` |
| Proposed category | Productivity. Confirm the current portal selection. |
| Proposed tags | routine, timer, planning, productivity. Confirm the portal's tag limits. |
| Listing text | [STORE_LISTING.md](STORE_LISTING.md) |
| Privacy notice | [PRIVACY.md](PRIVACY.md) |
| Developer name | TSUCHIYA LAB. Use the account owner's verified portal details. |

Use Node.js 24 or newer. Run the tests and build before packing, and keep the CLI's SDK selection pinned to 0.0.16. Inspect warnings and the resulting minimum app version; packing can derive that field from SDK metadata. [Official build instructions](https://hub.evenrealities.com/docs/cli/builds), updated 20 October 2026.

```sh
npm install
npm run check
npm run pack
```

## Prepare the artwork

The generated small icon is `public/icon-24.png`. The upload icon must be a PNG no larger than 1 MB, exactly 24 × 24 pixels, with transparent pixels or opaque `#F4F4F4` pixels arranged in complete 2 × 2 blocks. [Official icon rules](https://hub.evenrealities.com/docs/cli/apps), updated 20 October 2026.

The generated catalogue assets are `docs/assets/catalogue-icon.png` and `docs/assets/background.png`. The 256-pixel catalogue image is a project asset, not a claim that the portal requires that size. Confirm the current uploader's dimensions and size limits before using it.

Supply both foreground and background artwork in monochrome or grayscale. Capture the glasses screenshots with the official simulator and ensure that they show the release's actual screen content. A screenshot of the phone preview must be labelled as a phone preview and does not substitute for a simulator capture. [Official submission guidelines](https://hub.evenrealities.com/docs/ship/app-submission), updated 9 October 2026.

## Review the routine calculations

Use a temporary routine to exercise the calculation without personal data. Create one required step with the same normal and minimum duration, one required step with a lower minimum, and one optional step. Set a finish time that initially accommodates all three.

| Check | Expected result |
| --- | --- |
| Start with enough time. | The current step and a feasible finish-time margin appear. |
| Let the current step overrun. | The remaining allocation is recalculated; configured minimums remain protected. |
| Set a deadline shorter than the required minimums. | The app shows that the target cannot be met instead of inventing a feasible plan. |
| Wait until a step's allocation expires. | Time expiration alone does not record the action as completed. |
| Complete a step. | One tap advances progress and shows the next step. |
| Swipe to the next-step or timing overview and tap. | The current step returns without recording a completion. |
| Tap on the completion screen. | The routine chooser returns without starting another session. |
| Inspect an optional-step suggestion without acting. | The optional step remains in the routine. |
| Choose to skip an optional step. | Only the selected optional step is skipped. |
| Try to skip a required step. | The app keeps the required step. |
| Undo the last completion or skip. | The previous step state returns, and timing is recalculated. |
| Pause for one minute and resume. | The finish time stays fixed and the reduced available time is reflected. |
| Export, change a routine, then import the export. | The exported templates are added without replacing existing routines or contacting a server. Active session state and saved finish times are not imported. |
| Supply invalid JSON. | The app reports the problem and preserves usable existing data. |

Repeat the main flow with Japanese and English selected, including a long Japanese step name. Check the readable result on the actual glasses rather than judging text fit solely from the browser preview.

## Run the device checks before submission

Install the packaged build through the Even Hub beta path. Official guidance distinguishes beta behavior from local QR testing and calls for a five-minute locked-phone check; local QR preview is insufficient for that check. Root-page double tap must use the system confirmation, and a first-party app must still launch after exit. [Submission and lifecycle requirements](https://hub.evenrealities.com/docs/ship/app-submission).

Record the phone model, OS version, Even app version, glasses firmware, optional R1 firmware, build version, and result. Test the current App 2.4 combination as well as any older configuration that will be advertised as supported. The 2.2.10 SDK installation floor is not a record of tested device compatibility.

| Device check | Record before release |
| --- | --- |
| Cold-launch from the glasses with no saved session and without opening the phone page. | The routine chooser shows a starter or saved routine, its proposed finish date and time, and controls. |
| Swipe through routines and tap with the phone locked. | The selected routine starts with the displayed finish date and time. |
| Choose a routine with no saved finish time. | The proposal uses the usual step durations and the routine's margin. |
| Reopen a routine whose remembered finish time has already passed today. | The next occurrence is shown with its date; the app does not silently imply a finish today. |
| Run a routine with the phone locked for at least five minutes. | Timing remains correct and glasses inputs respond. |
| Tap, then hold on the glasses or ring. | The OS contextual menu opens; the initial gesture does not cause an unintended step completion. |
| Complete, pause, resume, and skip an optional step while locked. | Each action gives visible feedback and preserves the expected deadline. |
| Unlock, use another phone app, then lock again. | Verify the current routine state and display behavior. |
| Exit and reopen PaceCue. | Saved routines and progress return, with time recalculated from timestamps. |
| Restart after saving a changed routine under App 2.4. | The edited routine remains available. |
| Temporarily disconnect and reconnect the glasses. | Observe recovery or the documented reconnect message without losing saved progress. |
| Double tap, then cancel the system exit dialog. | The app continues without treating the cancelled dialog as a completed exit. |
| Double tap and confirm exit. | The system closes the session and its phone WebView. |
| Launch Conversate after exit. | The first-party app opens without restarting the glasses. |
| Use glasses touch input and, if available, the R1 ring. | Confirm the advertised gestures on each tested input device. |

Do not turn an unperformed check into a passing result. If a device test requires a code change, update the version and regenerate the package and matching screenshots.

## Register, submit, and publish

Sign in to the developer account and verify ownership before creating the application. Use the prepared package, icon, and listing text to create a private build; for an existing app, upload a new version instead. Complete developer information, artwork, permission information, and the privacy-policy field in the portal.

Use the current [Even Hub CLI guide](https://hub.evenrealities.com/docs/cli) for account, create, upload, and beta operations. Submission for review and public publication use the developer portal. A successful upload is a private build; an approval is a separate result from publication.

The public source and support repository is [tsuchiyatakahirolab/pacecue](https://github.com/tsuchiyatakahirolab/pacecue). The [privacy notice](https://github.com/tsuchiyatakahirolab/pacecue/blob/main/docs/PRIVACY.md) is included in the repository. Verify that the privacy-policy URL used in the portal is publicly accessible and accepted by the current uploader before submission.

For the review notes, include the temporary routine steps above and state the physical configurations actually tested. State that PaceCue has no sign-in, paid API, backend endpoint, or external data prerequisite. Explain the glasses-only chooser and start flow, the remembered finish time, the fixed deadline during a pause, and the user action required to skip an optional step.

## Record the actual outcome

| Event | Evidence to retain |
| --- | --- |
| Package created | Exact revision, package filename, and hash. |
| Build uploaded | Package ID, version, and returned build state. |
| Review submitted | Portal confirmation showing the version in review. |
| Review decided | Approval or rejection and any reviewer notes. |
| Store published | Public listing URL and the published version. |
| GitHub published | Repository URL, default branch, and published revision. |

Update the README status only after the corresponding result has been observed.
