// background service worker: トリガー配線と OpenAI 呼び出しの中継。
// ・ツールバークリック(action.onClicked) と ショートカット(commands.onCommand) を受けて
//   アクティブタブの content script へ {TRIGGER} を送る。
// ・content からの {TRANSLATE} を受けて OpenAI を呼び、結果/分類済みエラーを返す。
// ・{OPEN_OPTIONS} で設定ページを開く。
// リスナは defineBackground 直下で登録し、service worker 再起動後も確実に張り直される。

import { loadSettings } from '@/lib/storage';
import { translate } from '@/lib/openai';
import {
  RELOAD_BADGE_CLEAR_DELAY_MS,
} from '@/lib/constants';
import { saveObsidianNote, testObsidianConnection } from '@/lib/obsidian';
import type {
  ObsidianNotePayload,
  ObsidianResponse,
  RuntimeMessage,
  TranslateResponse,
} from '@/lib/messages';

export default defineBackground(() => {
  /** アクティブタブへトリガー送信。未注入タブ(拡張ロード前から開いていた等)では reject するので拾う。 */
  function trigger(tabId: number | undefined) {
    if (tabId == null) return;
    browser.tabs.sendMessage(tabId, { type: 'TRIGGER' }).catch(() => {
      hintReload(tabId);
    });
  }

  /** content script 未注入タブ向けのヒント。notifications 権限を増やさずバッジ＋ツールチップで促す。 */
  function hintReload(tabId: number) {
    browser.action.setBadgeText({ tabId, text: '↻' });
    browser.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
    browser.action.setTitle({
      tabId,
      title: 'transpost: このタブを再読み込みしてください（拡張を更新した直後はコンテンツが未注入です）',
    });
    // 数秒後にバッジを消す。
    setTimeout(
      () => browser.action.setBadgeText({ tabId, text: '' }),
      RELOAD_BADGE_CLEAR_DELAY_MS,
    );
  }

  // ツールバーアイコンのクリック（default_popup が無いので発火する）。
  browser.action.onClicked.addListener((tab) => trigger(tab.id));

  // カスタムショートカット。
  browser.commands.onCommand.addListener((command, tab) => {
    if (command === 'translate-post') trigger(tab?.id);
  });

  // content からのメッセージ処理。
  browser.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === 'TRANSLATE') {
      // 非同期応答のため true を返してチャンネルを開いたままにする。
      handleTranslate(message.text).then(sendResponse);
      return true;
    }
    if (message.type === 'SAVE_OBSIDIAN_NOTE') {
      // Obsidian保存は投稿後の副作用なので、失敗してもcontent側でtoastするだけにする。
      handleSaveObsidianNote(message.note).then(sendResponse);
      return true;
    }
    if (message.type === 'TEST_OBSIDIAN_CONNECTION') {
      // optionsページの接続テスト。保存せず、Vault root のlistで認証と疎通を確認する。
      handleTestObsidianConnection().then(sendResponse);
      return true;
    }
    if (message.type === 'OPEN_OPTIONS') {
      browser.runtime.openOptionsPage();
      return false;
    }
    return false;
  });

  /** 設定を読み出し、OpenAI へ翻訳を依頼。 */
  async function handleTranslate(text: string): Promise<TranslateResponse> {
    const settings = await loadSettings();
    return translate(settings, text);
  }

  /**
   * 設定を読み出してObsidianへ保存し、content scriptの投稿成功検知から呼ばれる。
   * @param note - 投稿済みの翻訳ノート内容。
   * @returns Obsidian保存の成功pathまたは分類済みエラー。
   * @example
   * await handleSaveObsidianNote(note) // => { ok: true, path: 'transpost-2026-07-01-120000-post.md' }
   */
  async function handleSaveObsidianNote(
    note: ObsidianNotePayload,
  ): Promise<ObsidianResponse> {
    const settings = await loadSettings();
    return saveObsidianNote(settings, note);
  }

  /**
   * Obsidian Local REST APIの疎通を確認し、optionsページのテストボタンから呼ばれる。
   * @returns 接続成功、またはAPI key/URL/ネットワークの分類済みエラー。
   * @example
   * await handleTestObsidianConnection() // => { ok: true, path: '' }
   */
  async function handleTestObsidianConnection(): Promise<ObsidianResponse> {
    const settings = await loadSettings();
    return testObsidianConnection(settings);
  }
});
