// 拡張内のメッセージ型定義。background ↔ content script 間のやり取りを型安全にする単一の出所。

/** 翻訳失敗の分類。パネルのエラー表示の出し分け（設定誘導 or 再試行）に使う。 */
export type TranslateErrorKind =
  | 'NO_KEY' // APIキー未設定 → 設定へ誘導
  | 'INVALID_KEY' // 401 → 設定へ誘導
  | 'MODEL_NOT_FOUND' // 404/400 model_not_found → 設定へ誘導
  | 'QUOTA' // 429 insufficient_quota（利用枠超過・再試行不可）
  | 'RATE_LIMIT' // 429 rate_limit（混雑・再試行可）
  | 'SERVER' // 500/503
  | 'NETWORK' // fetch 例外（オフライン等）
  | 'UNKNOWN';

/** OpenAI 翻訳呼び出しの結果。background が content へ返す。 */
export type TranslateResponse =
  | { ok: true; content: string }
  | { ok: false; error: TranslateErrorKind; message: string };

/** Obsidian保存失敗の分類。content/optionsのtoastや接続テスト表示に使う。 */
export type ObsidianErrorKind =
  | 'DISABLED'
  | 'NO_API_KEY'
  | 'BAD_URL'
  | 'UNAUTHORIZED'
  | 'HTTP'
  | 'NETWORK'
  | 'UNKNOWN';

/** 投稿後にObsidianへ保存する1投稿分の翻訳学習ノート内容。 */
export interface ObsidianNotePayload {
  original: string;
  english: string;
  postedText: string;
  kaisetsu: string[];
  pageUrl: string;
  translatedAtIso: string;
  postedAtIso: string;
}

/** Obsidian API 操作の結果。background が content/options へ返す。 */
export type ObsidianResponse =
  | { ok: true; path: string }
  | { ok: false; error: ObsidianErrorKind; message: string };

/** background → content（トリガー）。ツールバークリック/ショートカット由来。 */
export interface TriggerMessage {
  type: 'TRIGGER';
}

/** content → background。日本語テキストの翻訳依頼。 */
export interface TranslateMessage {
  type: 'TRANSLATE';
  text: string;
}

/** content → background。設定ページを開く依頼（content からは直接開けないため background 経由）。 */
export interface OpenOptionsMessage {
  type: 'OPEN_OPTIONS';
}

/** content → background。投稿成功後の翻訳ノート保存依頼。 */
export interface SaveObsidianNoteMessage {
  type: 'SAVE_OBSIDIAN_NOTE';
  note: ObsidianNotePayload;
}

/** options → background。Obsidian Local REST API の疎通確認依頼。 */
export interface TestObsidianConnectionMessage {
  type: 'TEST_OBSIDIAN_CONNECTION';
}

export type RuntimeMessage =
  | TriggerMessage
  | TranslateMessage
  | OpenOptionsMessage
  | SaveObsidianNoteMessage
  | TestObsidianConnectionMessage;
