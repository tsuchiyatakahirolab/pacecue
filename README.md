# PaceCue

PaceCue helps you finish a routine by a chosen time. It shows one step on Even G2, recalculates the remaining time when you run late, and keeps each step's minimum time in the plan. Optional steps are skipped only when you choose to skip them.

[日本語](README.ja.md) · [Product and competition](docs/PRODUCT.md) · [Privacy](docs/PRIVACY.md) · [Validation record](docs/QA.md) · [Submission guide](docs/SUBMISSION.md)

## Use the time you have

On the glasses, swipe to choose a saved or starter routine, check the displayed finish date and time, then tap to start. Complete each step with a tap while that step is on screen. If a step takes longer than expected, PaceCue adjusts the remaining allocation and shows when the deadline cannot be met.

- Reuse and edit routines for leaving home, preparing for work, focused work, or winding down.
- Set a normal duration and a minimum duration for each step, and mark steps as optional when appropriate.
- See the current step, its time allocation, and the remaining margin before the deadline.
- Pause, resume, skip an optional step, or undo an action from the contextual menu.
- Save routines and progress on the device, and import or export routine templates as JSON.
- Use the phone interface in English or Japanese.

Use the phone page to edit routines or enter a different finish time. PaceCue remembers the last finish time for each routine and offers its next occurrence; without one, it adds the usual step durations and the routine's margin to the current time. Daily starts can therefore use the glasses controls, while the displayed date makes a next-day target explicit.

Routines start manually. Pausing the routine pauses the current step's work timer; it does not move the finish time. Timing uses saved timestamps, so reopening the app recalculates from the current clock instead of assuming that background timer callbacks ran.

## Try the phone preview

Use Node.js 24 or newer and npm.

```sh
npm install
npm run dev
```

On Windows, you can also double-click `start-preview.cmd`. Open `http://localhost:5173`. The phone page includes a preview of the glasses content and works without a connected G2. This browser preview is useful for trying the routine planner; it does not reproduce the device's font, Bluetooth connection, or locked-phone lifecycle.

## Build and package

Download the prepared [PaceCue 0.1.0 package](submission/pacecue-0.1.0.ehpk) and [SHA256SUMS](submission/SHA256SUMS). Physical G2/R1 validation and Even Hub submission and approval remain pending. The package hash and completed software checks are recorded in [QA.md](docs/QA.md).

```sh
npm run check
npm run pack
```

`check` runs the automated tests and production build. `pack` creates `release/pacecue-0.1.0.ehpk` for Even Hub. The project uses TypeScript, Vite, and Even Hub SDK 0.0.16; it does not need an application server or an AI API key.

The SDK requires Even Realities App 2.2.10 or newer. Test the packaged beta on the actual phone and glasses combination before distributing it, including current App 2.4 behavior. [The submission guide](docs/SUBMISSION.md) separates local checks from the device tests that remain necessary.

## Glasses controls

| Input | Action |
| --- | --- |
| Swipe while choosing a routine | Select a saved or starter routine. |
| Tap while choosing a routine | Start with the displayed finish date and time. |
| Tap on the active step | Complete the visible step. |
| Swipe during a routine | Cycle through the current step, next step, and timing overview. |
| Tap on the next-step or timing view | Return to the current step without completing it. |
| Tap on the completion screen | Return to the routine chooser. |
| Tap, then hold | Open the contextual menu for pause/resume, optional-step skipping, and undo. |
| Double tap on the root page | Open the system exit confirmation. |

The routine chooser appears when no routine is running. The contextual-menu gesture is a tap followed by a hold, as described in the [official menu guide](https://hub.evenrealities.com/docs/build/contextual-menu). A countdown reaching zero does not confirm that you have completed a physical action.

## Data and operating costs

PaceCue has no account system, subscription, advertising, analytics, or runtime network calls. It stores routine data through the Even app's local storage API and keeps a browser copy for preview and recovery. The Even Realities host app and distribution platform have their own account and data practices; see [Privacy](docs/PRIVACY.md).

The current app has no per-use AI or server bill. Installing dependencies, obtaining the package, and using the host platform are separate from offline routine execution. JSON export also provides selectable text for WebViews where file downloads are unavailable. JSON export contains routine templates; it does not back up the active session or remembered finish times.

## Release status

The source was published on 7 November 2026 (JST) at [tsuchiyatakahirolab/pacecue](https://github.com/tsuchiyatakahirolab/pacecue). The initial source publication is commit [4ff62b0](https://github.com/tsuchiyatakahirolab/pacecue/commit/4ff62b02a3896e03703122b50f5060fe298c6c32). Version 0.1.0 is prepared for software evaluation; physical G2/R1 validation and Even Hub submission, approval, and publication have not been completed.

The timer is a planning aid based on the durations you enter. Background display delivery depends on the host app, and timestamp recovery does not guarantee that a cue appeared while the app was suspended. [Product notes](docs/PRODUCT.md) explain the difference from existing routine timers and checklists.

## License

MIT. Copyright 2026 TSUCHIYA LAB. See [LICENSE](LICENSE). Even Realities and G2 identify the supported platform; this project is independently developed.
