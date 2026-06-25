// x.com / twitter.com に注入する content script 本体。
// ・Shadow root 内に常駐パネルを1つ生成（x.com の CSS と相互遮断）。
// ・background からの {TRIGGER} で、アクティブな投稿欄の日本語を読み取り → background 経由で OpenAI 翻訳 →
//   パネルに表示。成功時のみ投稿欄をクリア（失敗時は日本語を保全＝再入力不要）。
// ・パネルは × ボタンでのみ閉じる（Esc・外側クリックでは閉じない＝仕様）。

import './panel.css';
import { mountPanel, type PanelHandle, type PanelState } from './panel';
import { activeComposer, readComposerText, isComposerEmpty, clearComposer } from './composer';
import { parseResult } from '@/lib/parseResult';
import type { RuntimeMessage, TranslateResponse } from '@/lib/messages';

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  cssInjectionMode: 'ui', // CSS を shadow root 内のみへ注入（ページへ漏らさない）
  async main(ctx) {
    let panel: PanelHandle | null = null;

    // 直近の翻訳対象。再試行(retry)で同じ原文を使い、成功時に同じ投稿欄をクリアするため保持。
    let lastOriginal = '';
    let lastComposer: HTMLElement | null = null;

    const ui = await createShadowRootUi(ctx, {
      name: 'transpost-ui',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      onMount: (container) => {
        const handle = mountPanel(container, {
          onClose: () => handle.hide(),
          onCopy: (text) => void copyToClipboard(text),
          onRetry: () => void retry(),
          onOpenSettings: () => void browser.runtime.sendMessage({ type: 'OPEN_OPTIONS' }),
        });
        panel = handle;
        return handle;
      },
    });
    ui.mount();

    // background からのトリガー受信。応答不要なので false を返す。
    browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
      if (message.type === 'TRIGGER') void onTrigger();
      return false;
    });

    /** トリガー本体: アクティブな投稿欄を特定し、空でなければ翻訳フローへ。 */
    async function onTrigger(): Promise<void> {
      if (!panel) return;
      const composer = activeComposer();
      if (!composer) {
        panel.toast('投稿欄が見つかりません');
        return;
      }
      if (isComposerEmpty(composer)) {
        panel.toast('日本語を入力してください');
        return;
      }
      const text = readComposerText(composer);
      lastOriginal = text;
      lastComposer = composer;
      await translate(text);
    }

    /** 再試行: 直近の原文で再翻訳（エラー時は投稿欄を保全しているので原文は残っている）。 */
    async function retry(): Promise<void> {
      if (!lastOriginal) return;
      await translate(lastOriginal);
    }

    /**
     * 翻訳の実行とパネル描画。
     * 成功時のみ投稿欄をクリア（タイピング学習の準備）。失敗時は日本語を保全。
     * @param text 翻訳対象の日本語
     */
    async function translate(text: string): Promise<void> {
      if (!panel) return;
      panel.render({ status: 'loading', original: text });
      panel.show();

      let response: TranslateResponse;
      try {
        response = (await browser.runtime.sendMessage({
          type: 'TRANSLATE',
          text,
        })) as TranslateResponse;
      } catch {
        // background が応答しない（SW 落ち/拡張更新直後など）。
        panel.render({
          status: 'error',
          kind: 'UNKNOWN',
          message: '拡張機能と通信できませんでした。ページを再読み込みしてください。',
        });
        return;
      }

      if (response.ok) {
        const { english, kaisetsu } = parseResult(response.content);
        const state: PanelState = { status: 'success', original: text, english, kaisetsu };
        panel.render(state);
        void clearComposerForSuccess();
      } else {
        panel.render({ status: 'error', kind: response.error, message: response.message });
      }
    }

    /** 成功後の投稿欄クリア。保持していた要素が生きていればそれを、無ければ現在のアクティブ欄を消す。 */
    async function clearComposerForSuccess(): Promise<void> {
      const target =
        lastComposer && lastComposer.isConnected ? lastComposer : activeComposer();
      if (target) await clearComposer(target);
    }

    /** クリップボードへコピー。navigator.clipboard が使えない場合は execCommand にフォールバック。 */
    async function copyToClipboard(text: string): Promise<void> {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // フォールバック: 一時 textarea を選択して execCommand('copy')
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } finally {
          ta.remove();
        }
      }
    }
  },
});
