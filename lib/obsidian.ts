// Obsidian Local REST API 連携。background service worker から呼び出してVault相対pathへMarkdownを保存する。

import {
  DATE_PART_PAD_LENGTH,
  OBSIDIAN_FILENAME_SLUG_MAX_LENGTH,
} from './constants';
import type { ObsidianNotePayload, ObsidianResponse } from './messages';
import type { Settings } from './storage';

/**
 * Obsidian Local REST APIへMarkdownをPUTし、投稿成功後のcontent script要求から呼ばれる。
 * @param settings - Obsidian API URL/API key/保存先フォルダを含む設定。
 * @param note - 翻訳元・翻訳結果・投稿本文・解説を含む保存内容。
 * @returns 成功時は作成path、失敗時はUI表示用の分類済みエラー。
 * @example
 * await saveObsidianNote(settings, note) // => { ok: true, path: 'transpost-2026-07-01-120000-post.md' }
 */
export async function saveObsidianNote(
  settings: Settings,
  note: ObsidianNotePayload,
): Promise<ObsidianResponse> {
  if (!settings.obsidianEnabled) {
    return { ok: false, error: 'DISABLED', message: 'Obsidian保存は無効です。' };
  }
  if (!settings.obsidianApiKey.trim()) {
    return { ok: false, error: 'NO_API_KEY', message: 'Obsidian API key が未設定です。' };
  }

  const baseUrl = normalizeApiUrl(settings.obsidianApiUrl);
  if (!baseUrl) {
    return { ok: false, error: 'BAD_URL', message: 'Obsidian API URL が不正です。' };
  }

  const vaultPath = buildObsidianVaultPath(settings.obsidianOutputFolder, note);
  const markdown = buildObsidianNoteMarkdown(note);
  const endpoint = `${baseUrl}/vault/${encodeVaultPath(vaultPath)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${settings.obsidianApiKey.trim()}`,
        'Content-Type': 'text/markdown',
      },
      body: markdown,
    });

    if (response.ok) return { ok: true, path: vaultPath };
    return await createHttpErrorResponse(response);
  } catch {
    return {
      ok: false,
      error: 'NETWORK',
      message: 'Obsidian Local REST API に接続できませんでした。',
    };
  }
}

/**
 * Obsidian Local REST APIの疎通確認を行い、optionsページの接続テストから呼ばれる。
 * @param settings - Obsidian API URL/API keyを含む設定。
 * @returns 成功時はok、失敗時は保存処理と同じエラー分類。
 * @example
 * await testObsidianConnection(settings) // => { ok: true, path: '' }
 */
export async function testObsidianConnection(settings: Settings): Promise<ObsidianResponse> {
  if (!settings.obsidianApiKey.trim()) {
    return { ok: false, error: 'NO_API_KEY', message: 'Obsidian API key が未設定です。' };
  }

  const baseUrl = normalizeApiUrl(settings.obsidianApiUrl);
  if (!baseUrl) {
    return { ok: false, error: 'BAD_URL', message: 'Obsidian API URL が不正です。' };
  }

  try {
    const response = await fetch(`${baseUrl}/vault/`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${settings.obsidianApiKey.trim()}` },
    });

    if (response.ok) return { ok: true, path: '' };
    return await createHttpErrorResponse(response);
  } catch {
    return {
      ok: false,
      error: 'NETWORK',
      message: 'Obsidian Local REST API に接続できませんでした。',
    };
  }
}

/**
 * Obsidian API URLをfetch可能なorigin形式へ整え、設定保存後の通信処理から呼ばれる。
 * @param apiUrl - 設定画面で入力されたURL。
 * @returns 有効なURLなら末尾スラッシュなしの文字列、不正なら空文字。
 * @example
 * normalizeApiUrl('http://127.0.0.1:27123/') // => 'http://127.0.0.1:27123'
 */
export function normalizeApiUrl(apiUrl: string): string {
  try {
    const url = new URL(apiUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * Vault相対フォルダとファイル名を結合し、Obsidian保存直前に呼ばれる。
 * @param outputFolder - 設定されたVault相対フォルダ。
 * @param note - slug生成に使う投稿データ。
 * @returns Obsidian APIへ渡すVault相対path。
 * @example
 * buildObsidianVaultPath('Agentic OS/raw/transpost', note) // => 'Agentic OS/raw/transpost/transpost-2026-07-01-120000-post.md'
 */
export function buildObsidianVaultPath(outputFolder: string, note: ObsidianNotePayload): string {
  const folder = normalizeVaultFolder(outputFolder);
  const filename = buildObsidianFilename(note);
  return folder ? `${folder}/${filename}` : filename;
}

/**
 * Vault相対pathをsegment単位でURL encodeし、日本語フォルダ名を安全にAPIへ渡すために呼ばれる。
 * @param vaultPath - Obsidian Vault相対path。
 * @returns `/` だけ残し、各path segmentをencodeURIComponentした文字列。
 * @example
 * encodeVaultPath('英語/投稿メモ.md') // => '%E8%8B%B1%E8%AA%9E/%E6%8A%95%E7%A8%BF%E3%83%A1%E3%83%A2.md'
 */
export function encodeVaultPath(vaultPath: string): string {
  return vaultPath.split('/').map(encodeURIComponent).join('/');
}

/**
 * 投稿データからMarkdown本文を作り、Obsidian保存処理から呼ばれる。
 * @param note - 翻訳元・翻訳結果・投稿本文・解説。
 * @returns 1投稿1ノートとして保存するMarkdown文字列。
 * @example
 * buildObsidianNoteMarkdown(note).includes('## 翻訳元') // => true
 */
export function buildObsidianNoteMarkdown(note: ObsidianNotePayload): string {
  const title = `transpost ${formatFilenameTimestamp(new Date(note.postedAtIso))}`;
  const explanation =
    note.kaisetsu.length > 0
      ? note.kaisetsu
          .map((content, index) => `### 解説 ${index + 1}\n\n${escapeMarkdownFence(content)}`)
          .join('\n\n')
      : '（解説はありません）';

  return `---
created: ${JSON.stringify(note.postedAtIso)}
translated: ${JSON.stringify(note.translatedAtIso)}
source_url: ${JSON.stringify(note.pageUrl)}
tags:
  - transpost
  - translation
status: posted
---

# ${title}

## 翻訳元

\`\`\`text
${escapeMarkdownFence(note.original)}
\`\`\`

## 翻訳結果

\`\`\`text
${escapeMarkdownFence(note.english)}
\`\`\`

## 投稿した本文

\`\`\`text
${escapeMarkdownFence(note.postedText)}
\`\`\`

## 翻訳結果との差分

${buildPostedTextDiff(note.english, note.postedText)}

## 解説

${explanation}
`;
}

/**
 * Vault相対フォルダを正規化し、設定保存と保存path生成の両方で使う。
 * @param folder - ユーザー入力のVault相対フォルダ。
 * @returns 先頭/末尾slashを除き、重複slashを畳んだフォルダpath。
 * @example
 * normalizeVaultFolder('/Agentic OS//raw/') // => 'Agentic OS/raw'
 */
export function normalizeVaultFolder(folder: string): string {
  return folder
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/**
 * Obsidianノートのファイル名を作り、Vault path生成から呼ばれる。
 * @param note - timestampとslug候補を含む投稿データ。
 * @returns `transpost-YYYY-MM-DD-HHmmss-{slug}.md` 形式のファイル名。
 * @example
 * buildObsidianFilename(note).startsWith('transpost-') // => true
 */
function buildObsidianFilename(note: ObsidianNotePayload): string {
  const postedAt = new Date(note.postedAtIso);
  const slug = buildFilenameSlug(note.postedText || note.english || note.original);
  return `transpost-${formatFilenameTimestamp(postedAt)}-${slug}.md`;
}

/**
 * 投稿本文からファイル名用slugを作り、ファイル名生成から呼ばれる。
 * @param text - 投稿本文・英訳・翻訳元のいずれか。
 * @returns ファイル名に使える短いslug。
 * @example
 * buildFilenameSlug('Hello, world!') // => 'Hello-world'
 */
function buildFilenameSlug(text: string): string {
  const slug = text
    .trim()
    .replace(/[\\/:*?"<>|#^[\]\n\r\t]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, OBSIDIAN_FILENAME_SLUG_MAX_LENGTH);
  return slug || 'post';
}

/**
 * Dateをファイル名向けtimestampへ変換し、ノートタイトルとファイル名生成から呼ばれる。
 * @param date - 投稿成功時刻。
 * @returns `YYYY-MM-DD-HHmmss` 形式のローカル時刻文字列。
 * @example
 * formatFilenameTimestamp(new Date('2026-07-01T03:04:05Z')) // => '2026-07-01-120405' in JST
 */
function formatFilenameTimestamp(date: Date): string {
  const year = String(date.getFullYear());
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());
  const second = padDatePart(date.getSeconds());
  return `${year}-${month}-${day}-${hour}${minute}${second}`;
}

/**
 * 日付部品を2桁へ揃え、timestamp生成から呼ばれる。
 * @param value - 月日または時分秒。
 * @returns 2桁の文字列。
 * @example
 * padDatePart(4) // => '04'
 */
function padDatePart(value: number): string {
  return String(value).padStart(DATE_PART_PAD_LENGTH, '0');
}

/**
 * 投稿時本文と翻訳結果の差分ブロックを作り、Markdown生成から呼ばれる。
 * @param english - AIが返した英訳。
 * @param postedText - 実際にXへ投稿した本文。
 * @returns 差分なしテキスト、またはdiffコードブロック。
 * @example
 * buildPostedTextDiff('Hi', 'Hi!').includes('```diff') // => true
 */
function buildPostedTextDiff(english: string, postedText: string): string {
  if (normalizeTextForComparison(english) === normalizeTextForComparison(postedText)) {
    return '差分なし。翻訳結果をそのまま投稿しました。';
  }

  return `投稿前に本文を編集しています。

\`\`\`diff
- ${escapeDiffLine(english)}
+ ${escapeDiffLine(postedText)}
\`\`\``;
}

/**
 * 比較用にテキストの端だけ整え、投稿差分判定から呼ばれる。
 * @param text - 比較対象の本文。
 * @returns 前後空白だけ除いた文字列。
 * @example
 * normalizeTextForComparison(' hi ') // => 'hi'
 */
function normalizeTextForComparison(text: string): string {
  return text.trim();
}

/**
 * Markdown fenceを壊さないよう本文を退避し、ノート本文生成から呼ばれる。
 * @param text - Markdown内のコードブロックに入れる文字列。
 * @returns fence終端を無害化した文字列。
 * @example
 * escapeMarkdownFence('```') // => '``\\u200b`'
 */
function escapeMarkdownFence(text: string): string {
  return text.replace(/```/g, '``\u200b`');
}

/**
 * diffコードブロックの1行表示を保ち、投稿差分生成から呼ばれる。
 * @param text - diffへ入れる本文。
 * @returns 改行をインデント付きで表示する文字列。
 * @example
 * escapeDiffLine('a\\nb') // => 'a\\n  b'
 */
function escapeDiffLine(text: string): string {
  return escapeMarkdownFence(text).replace(/\n/g, '\n  ');
}

/**
 * HTTP失敗をUI向けエラーへ分類し、保存/接続テストのfetch失敗後に呼ばれる。
 * @param response - fetchが返した失敗レスポンス。
 * @returns statusに応じたObsidianResponse。
 * @example
 * await createHttpErrorResponse(new Response('', { status: 401 })) // => { ok: false, error: 'UNAUTHORIZED', ... }
 */
async function createHttpErrorResponse(response: Response): Promise<ObsidianResponse> {
  const body = await response.text().catch(() => '');
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: 'UNAUTHORIZED',
      message: 'Obsidian API key が拒否されました。',
    };
  }

  return {
    ok: false,
    error: 'HTTP',
    message: `Obsidian保存に失敗しました（HTTP ${response.status}${body ? `: ${body}` : ''}）。`,
  };
}
