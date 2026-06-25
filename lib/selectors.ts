// X(Twitter) の DOM セレクタを一元管理。X が data-testid を変えた際の単一修正点。
// 2026-06 にログイン済み実機で検証済みの値（Draft.js コンポーザー）。

export const SEL = {
  /**
   * 投稿コンポーザー関連要素（スレッド投稿で _0/_1/... と連番になるため前方一致）。
   * ⚠️ この前方一致は contenteditable 本体(`tweetTextarea_0`)だけでなく非編集ラッパー
   * (`tweetTextarea_0_label` / `tweetTextarea_0RichTextInputContainer`)も拾う。実際の編集対象は
   * `el.isContentEditable` で絞ること（activeComposer がそうする）。祖先ラッパーへ合成 Backspace を投げると
   * Draft の editOnKeyDown へ届かずクリアが無反応になる（2026-06-14 実機 E2E で確定）。
   */
  composer: '[data-testid^="tweetTextarea_"]',
  /** インライン投稿ボタン（ホームタイムライン上部の作成欄）。 */
  postButtonInline: '[data-testid="tweetButtonInline"]',
  /** モーダル/リプライ等の投稿ボタン。 */
  postButton: '[data-testid="tweetButton"]',
  /** 開いているモーダルダイアログ（フルスクリーン作成/リプライ等）。 */
  dialog: '[role="dialog"][aria-modal="true"]',
  /** Lexical 移行検知用。これが付いていたら Draft.js ではなく Lexical。 */
  lexicalEditor: '[data-lexical-editor]',
} as const;
