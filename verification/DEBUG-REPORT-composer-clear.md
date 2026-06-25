# DEBUG REPORT — 翻訳後にコンポーザーが入力/削除不能になるバグ

**日付**: 2026-06-14
**対象**: `entrypoints/content/composer.ts` の `clearComposer` / `isComposerEmpty`
**起票**: 「翻訳後オリジナルの Post が消えたあと、Post の Editor で文章を入力・削除できなくなる」

---

## 症状（観測された挙動）

翻訳成功 → 投稿欄の日本語を自動クリア → そのあとユーザーが英訳を打ち直そうとすると、
コンポーザーが「ゾンビ化」して以下の状態になる:

- 生のキー入力は `innerText` には乗る（画面に文字は見える）が、Draft.js がモデルへ反映しない
- **Backspace / Delete が一切効かない**（削除不能）
- 空ブロックの目印 `[data-text="true"]` span が **0個**になる（健全な空は1個）
- クリックし直しても回復しない

## 根本原因（Iron Law: 確証済み）

旧 `clearComposer` は

```ts
el.focus();
document.execCommand('selectAll', false);
document.execCommand('delete', false);   // ← これが原因
```

を使っていた。`execCommand('delete')` は **DOM を直接書き換える**だけで、Draft.js が内部に持つ
`EditorState`（モデル）と DOM を**乖離**させる。Draft は「自分のモデル経由でない DOM 変更」を
不正状態とみなし、以後の入力イベントをモデルへ reconcile しなくなる。結果、DOM 上は文字が増減する
ように見えても Draft の `data-text` span は再生成されず、削除コマンドも EditorState に届かない。

副次バグ: `isComposerEmpty` が `!el.querySelector('[data-text="true"]')`（span の有無）で空判定して
いた。壊れ状態では span が0個になるため**「空」と誤判定**し、本来検知すべき失敗を隠していた。
逆に健全クリア後は空 span が1個残るため、未入力でも「非空」と誤判定する二重の誤り。

## 再現（Phase 1）

ログイン済み実機 X 上で `playwright-cli run-code` により決定論的に再現（`/tmp/tp-exp1.js`）。
さらに `execCommand('delete')` 直後に合成キー入力を流すと `innerText` には乗るが
`data-text` span が0個のまま＝モデル未反映、を数値で確認した。

## 修正（Phase 4）

Draft 自身の削除パイプラインを通すことで、DOM と EditorState の同期を保ったまま空にする:

```
el.focus()
 → requestAnimationFrame ×2 待ち   // focus 直後は選択コンテキスト未確立
 → range.selectNodeContents(el)    // エディタ内容を全選択
 → dispatch 'select' + 'selectionchange'  // React→Draft の editOnSelect が
                                           //   EditorState.selection をフル範囲へ同期
 → 合成 Backspace keydown/keyup (keyCode 8)  // Draft が自身のモデルでフル選択を削除
 → requestAnimationFrame ×2 待ち → 空判定を返す
```

破壊的フォールバック（`execCommand('delete')` / 明示 Range + delete / 合成 InputEvent）は
**全廃**。`isComposerEmpty` はテキスト基準 `readComposerText(el) === ''` に変更。

### 重要な発見（実フロー忠実テストで判明）

`requestAnimationFrame`×2 待ちは**必須**。コンポーザーから focus が外れた状態
（＝ツールバーアイコン起動 → OpenAI 待ち → クリア、の経路）で `el.focus()` 直後に
同期的に全選択しても、選択がエディタ外を指してしまい **1文字しか消えない**ことを実機で確認した。
2フレーム待って Draft の focus 再レンダリングを確定させると、全選択がモデルへ正しく届く。

> ⚠️ ただし rAF×2 は**経験的にチューニングしたレース回避**であって保証ではない（実測 0 fail / 検証時）。
> 低速マシンや高負荷で React の focus コミットが2フレームに間に合わないと再発しうる。
> **その時の症状は「クリア後に1文字だけ残る／末尾1文字しか消えない」**——この署名を見たら
> rAF 待ちフレーム数の不足を疑うこと（verify-and-retry 化は本件の要求を超える複雑化なので採らない）。

### 変更ファイル

- `entrypoints/content/composer.ts` — `clearComposer`（async 化・新手順）、`isComposerEmpty`（テキスト基準）、
  ヘルパ `waitAnimationFrames` / `dispatchBackspaceThroughDraft`、ファイル先頭コメント更新
- `entrypoints/content/index.ts` — `clearComposerForSuccess` を async 化し `await clearComposer`
- `lib/selectors.ts` — 不要になった `draftText` セレクタを削除

## 検証（Phase 5）

- `pnpm compile`（tsc --noEmit）: ✅ エラーなし
- `pnpm build`（wxt build）: ✅ 成功。ビルド出力に `execCommand('delete')` が**消えた**ことを grep で確認
- 実機 X 機構検証 `verification/composer-clear.regression.mjs`: **`summary.allPassed: true`**
  - pristine（未入力）空判定: ✅
  - **focused 経路**（ショートカット相当・focus 残存）: クリア後 空・空ブロック1個、再入力 `Hello`・Backspace×2→`Hel` ✅
  - **blurred 経路**（ツールバー相当・blur 後1.5s）: 同上 ✅
  - **single-line 経路**（最も多い実下書きの形）: 同上 ✅

> ⚠️ **このスクリプトの性質を誤解しないこと。** 拡張をロードできない事情のため、`clearComposer` を
> **直接呼ばず**に同じ手順を page world へ複製して実機 X 上で再現・検証している。すなわち
> 「機構検証＋手動再実行」アーティファクトであって、**ソース連動の自動回帰ガードではない**。
> 仮に将来 `composer.ts` に `execCommand('delete')` が再混入しても本テストは素通りする。
> `composer.ts` の `clearComposer` を変更したら、このスクリプトの複製ロジックも**手で同期**すること
> （`composer.ts` 先頭にも相互参照コメントを記載済み）。

## 残存リスク / 未検証（正直な申告）

- **拡張機能を実際にロードした状態での E2E は未実施**（MV3 ロードが別件で失敗中）。検証は content script と
  同一の DOM/イベント機構を持つ page world で行ったもの。コンテンツスクリプト（isolated world）から
  共有 DOM に dispatch したイベントが page world の Draft リスナへ届くことは設計上確実だが、最終確認は
  拡張ロード後のユーザー手動 E2E に委ねる。
- **ウィンドウ自体が非フォーカスのケース**（ツールバークリックでブラウザクロームへ focus が移る厳密な状況）は
  `el.blur()`（同一ドキュメント内 focus 移動）で近似再現した。完全な window 非フォーカスは拡張ロード後に確認推奨。
- **モーダル/リプライ経路**（`/compose/post` で `tweetTextarea_0` が2個共存）は同一機構のため低リスクだが本テストは
  インライン欄のみ。

## 回帰テストの再実行手順

```bash
# 1) /cookie スキルで Chrome cookie を取り込んだ persistent セッションを用意
playwright-cli open --persistent
playwright-cli run-code --filename=/tmp/chrome-load-cookies.js   # ロード後 /tmp の平文cookieは即削除
# 2) 回帰テスト実行（x.com ログイン済みであること）
playwright-cli run-code --filename=verification/composer-clear.regression.mjs
# 期待: 返り値 JSON の summary.allPassed === true
```
