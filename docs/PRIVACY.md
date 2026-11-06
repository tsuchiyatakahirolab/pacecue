# PaceCue privacy notice

Version 0.1.0. Last updated: 7 November 2026 (JST). Developer: TSUCHIYA LAB.

## What PaceCue stores

PaceCue stores the routines you enter, step names, duration settings, optional-step choices, language preferences, the last finish time chosen for each routine, and the state needed to resume a session. Session data includes timing and progress information. These values are used to display the current step, suggest the next finish date and time, and calculate the time remaining.

Inside Even Hub, PaceCue uses the Even app's local storage API and keeps a browser storage copy for preview and recovery. In an ordinary browser, it uses that browser's local storage. Data is associated with the device or browser profile; PaceCue does not provide synchronization between devices.

## What PaceCue sends

PaceCue does not send your routines, progress, or timing data to a developer-operated server or an AI service. This version makes no application-level network requests and has no analytics, advertising, account system, or subscription. Its manifest requests no optional network, microphone, camera, album, or location permissions, and it does not access your calendar.

The Even Realities app, its SDK transport, your operating system, and the services used to obtain or update the app operate separately. Their handling of installation, account information, diagnostics, backups, or other platform data is governed by their own settings and policies. PaceCue's local design is not a statement that the entire host platform has no network activity.

## Import, export, and deletion

JSON import reads the file you choose and adds routine templates. JSON export creates a file on your device containing routine names, steps, and duration settings; it does not include the active session or remembered finish times. PaceCue does not upload that file; any later sharing, email, cloud backup, or public repository upload is controlled by you and the service you choose.

Use the app's reset control to replace PaceCue's saved routines and progress with the initial state. Reset the browser preview separately if you have also used it outside Even Hub. Exported files and copies you have shared are separate files and must be removed separately.

Removing an app, clearing browser data, changing browser profiles, or resetting the host app can make local data unavailable. Keep an export if you need a portable copy. PaceCue cannot retrieve a lost local copy from a server because it does not maintain one.

## Storage security

PaceCue does not add application-level encryption to its local JSON data or exported files. Browser storage is plaintext, and protection of device storage depends on the host app and operating system. Treat exports and a device that can display your routines as containing the information you entered.

## Contact and updates

The public source and support repository is [tsuchiyatakahirolab/pacecue](https://github.com/tsuchiyatakahirolab/pacecue), published on 7 November 2026 (JST). Use the repository's issue tracker for product questions without attaching private routines or exports. A future version that changes the app's data handling should update this notice with the new version and date.

---

# PaceCueのプライバシーについて

対象：v0.1.0。更新日：2026年11月7日（JST）。開発者：TSUCHIYA LAB。

PaceCueは、入力したルーティン、手順名、時間設定、省略可能な手順、言語設定、ルーティンごとの前回の終了時刻、再開に必要な進捗と日時を保存します。Even Hub内ではEvenアプリの保存APIを使用し、プレビューと復旧用にブラウザーにも保存します。通常のブラウザーで使用したデータは、そのブラウザーの保存領域に残り、端末間の同期は行いません。

このバージョンは、ルーティンや進捗を開発者のサーバーやAIサービスへ送信しません。アカウント、定期課金、広告、解析機能を備えず、ネットワーク、音声、カメラ、アルバム、位置情報の追加権限やカレンダーへのアクセスも使用しません。Even Realitiesアプリ、SDK、OS、配布サービスが扱うアカウントや診断情報などは、それぞれの設定と方針に従います。

JSONの読み込みはユーザーが選んだファイルからテンプレートを追加し、書き出しは端末上にファイルを作成します。書き出すのはルーティン名、手順、所要時間などで、実行中の進捗や記憶した終了時刻は含みません。後から共有したりクラウドに保存したりする場合は内容を確認してください。PaceCue自身がそのファイルをアップロードすることはありません。

アプリのリセット操作により、保存したルーティンと進捗を初期状態に置き換えられます。別のブラウザーで利用したプレビューや書き出したファイルは、必要に応じてそれぞれ削除してください。端末内のデータを失った場合、開発者のサーバーから復元することはできません。

PaceCueは保存データと書き出しファイルに独自の暗号化を加えません。ブラウザーの保存データは平文であり、端末内保存の保護はEvenアプリとOSの仕組みに依存します。ソースコードとサポート先は[tsuchiyatakahirolab/pacecue](https://github.com/tsuchiyatakahirolab/pacecue)で、2026年11月7日（JST）に公開しました。
