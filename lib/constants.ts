// 拡張全体で共有する設定値。時間・長さ・既定URLを1箇所に集約して挙動変更を安全にする。

/** Obsidian Local REST API のHTTP既定URL。 */
export const OBSIDIAN_DEFAULT_API_URL = 'http://127.0.0.1:27123';
/** 投稿成功を待つ最大時間。X側の投稿処理が詰まったら保存を諦める。 */
export const POST_SUCCESS_TIMEOUT_MS = 8000;
/** 投稿後のコンポーザー状態を確認する間隔。 */
export const POST_SUCCESS_POLL_INTERVAL_MS = 250;
/** 投稿ボタンを押したときだけObsidian保存を1回に絞るための短い待機。 */
export const POST_CLICK_SETTLE_DELAY_MS = 50;
/** Obsidianノートファイル名のslug最大長。 */
export const OBSIDIAN_FILENAME_SLUG_MAX_LENGTH = 48;
/** ファイル名の日付部品を2桁に揃える桁数。 */
export const DATE_PART_PAD_LENGTH = 2;
/** 設定画面の一時ステータスを消すまでの時間。 */
export const SETTINGS_STATUS_CLEAR_DELAY_MS = 2600;
/** content script 未注入ヒントのバッジを消すまでの時間。 */
export const RELOAD_BADGE_CLEAR_DELAY_MS = 6000;
