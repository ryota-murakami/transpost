// background service worker: トリガー配線と OpenAI 呼び出しの中継。
// ・ツールバークリック(action.onClicked) と ショートカット(commands.onCommand) を受けて
//   アクティブタブの content script へ {TRIGGER} を送る。
// ・content からの {TRANSLATE} を受けて OpenAI を呼び、結果/分類済みエラーを返す。
// ・{OPEN_OPTIONS} で設定ページを開く。
// リスナは defineBackground 直下で登録し、service worker 再起動後も確実に張り直される。

import { loadSettings } from '@/lib/storage';
import { translate } from '@/lib/openai';
import type { RuntimeMessage, TranslateResponse } from '@/lib/messages';

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
    setTimeout(() => browser.action.setBadgeText({ tabId, text: '' }), 6000);
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
});
