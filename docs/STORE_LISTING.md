# PaceCue store listing draft

Prepared for version 0.1.0 on 6 November 2026. This is editable submission copy; it does not indicate that a store listing is live.

## Identity

| Field | Draft value |
| --- | --- |
| Name | PaceCue |
| Package ID | com.tsuchiyalab.pacecue |
| Developer | TSUCHIYA LAB |
| Category | Productivity, subject to the portal's available categories. |
| Languages | English and Japanese. |
| Tags | routine, timer, planning, productivity. |
| Support | Public source and support: [tsuchiyatakahirolab/pacecue](https://github.com/tsuchiyatakahirolab/pacecue), published on 7 November 2026 (JST). |
| Privacy | [Privacy notice](https://github.com/tsuchiyatakahirolab/pacecue/blob/main/docs/PRIVACY.md). Verify accessibility and acceptance of the submitted URL in the current portal. |

## English tagline

Fit your routine to the time you have.

## English description

PaceCue helps you finish a routine by a chosen time. Prepare to leave home, get ready for work, or follow a sequence of tasks while the next step stays in view on Even G2.

On the glasses, swipe to choose a saved or starter routine, check the finish date and time, and tap to start. PaceCue remembers each routine's last finish time; without one, it uses the usual step durations and margin.

Each step has a normal and minimum duration. When you run late, PaceCue recalculates the remaining time and shows when the deadline cannot be met. Optional steps are skipped only when you choose.

Tap the current step to complete it. A tap on the next-step or timing view returns to the current step. Tap, then hold to open the menu for pause, resume, optional skips, and undo. Pausing does not move the deadline.

Use the phone to edit routines or enter a finish time. Import and export routine templates as JSON. English and Japanese are available. Routines start manually.

PaceCue requires no additional account, subscription, AI API key, or application server. Routine data stays on your device. The Even Realities host app and distribution platform operate separately.

## 日本語の短い説明

終了時刻に合わせて、残りの手順と時間を調整。

## 日本語の説明

PaceCueは、指定した終了時刻に合わせて準備や作業を進めるアプリです。外出前、仕事の準備、就寝前などの手順を、Even G2で1つずつ確認できます。

G2でスワイプしてルーティンを選び、終了日時を確認してタップすると開始します。前回の終了時刻を記憶し、保存がない場合は通常時間と余裕時間から計算します。編集と終了時刻の入力はスマートフォンで行います。

各手順には通常時間と最低時間を設定でき、遅れた場合は残り時間を再配分します。間に合わない場合は超過を示し、省略はユーザーが選んだ場合だけ行います。

現在の手順でタップすると完了し、他の表示でタップすると現在の手順に戻ります。タップしてから長押しするとメニューを開けます。一時停止中も終了時刻は変わりません。

テンプレートはJSONで入出力できます。日本語・英語に対応し、開始は手動です。追加アカウント、定期課金、AIのAPIキー、アプリ用サーバーは不要で、データは端末内に保存します。

## Release notes in English

Choose and start routines from your glasses with a remembered finish time. Recalculate after delays, protect minimum step times, and confirm optional skips. Save progress on your device in English or Japanese.

## 日本語の更新内容

G2から手順を選び、前回の終了時刻で開始できます。各手順の最低時間を守り、遅れに応じて再計算します。任意の手順の省略、進捗保存、JSONの入出力、日本語・英語に対応します。

## Reviewer notes

The app has no sign-in or external API setup. Cold-launch from the glasses, swipe to choose a routine, check its finish date and time, and tap to start. Use the phone page for edits or a different deadline. Tapping a next-step or timing overview returns to the current step without completing it. The fixed finish time continues to approach during a pause, and optional steps are not automatically skipped. See [SUBMISSION.md](SUBMISSION.md) for reproducible checks and record the actual tested phone, firmware, and Even app versions before submission.

Physical device testing has not yet been performed. Do not describe browser preview images as simulator or hardware captures. Replace this preparation note with the observed test results when the release is ready for review.
