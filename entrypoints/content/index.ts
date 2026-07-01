// x.com / twitter.com に注入する content script 本体。
// ・Shadow root 内に常駐パネルを1つ生成（x.com の CSS と相互遮断）。
// ・background からの {TRIGGER} で、アクティブな投稿欄の日本語を読み取り → background 経由で OpenAI 翻訳 →
//   パネルに表示。成功時のみ投稿欄をクリア（失敗時は日本語を保全＝再入力不要）。
// ・パネルは × ボタンでのみ閉じる（Esc・外側クリックでは閉じない＝仕様）。

import './panel.css';
import { mountPanel, type PanelHandle, type PanelState } from './panel';
import { activeComposer, readComposerText, isComposerEmpty, clearComposer } from './composer';
import {
  POST_CLICK_SETTLE_DELAY_MS,
  POST_SUCCESS_POLL_INTERVAL_MS,
  POST_SUCCESS_TIMEOUT_MS,
} from '@/lib/constants';
import { parseResult } from '@/lib/parseResult';
import { SEL } from '@/lib/selectors';
import type {
  ObsidianResponse,
  RuntimeMessage,
  TranslateResponse,
} from '@/lib/messages';

interface PendingObsidianNote {
  original: string;
  english: string;
  kaisetsu: string[];
  translatedAtIso: string;
  composer: HTMLElement | null;
  saved: boolean;
  saving: boolean;
}

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  cssInjectionMode: 'ui', // CSS を shadow root 内のみへ注入（ページへ漏らさない）
  async main(ctx) {
    let panel: PanelHandle | null = null;

    // 直近の翻訳対象。再試行(retry)で同じ原文を使い、成功時に同じ投稿欄をクリアするため保持。
    let lastOriginal = '';
    let lastComposer: HTMLElement | null = null;
    let pendingObsidianNote: PendingObsidianNote | null = null;

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

    // Xの投稿クリックを止めずに観測し、成功後だけObsidian保存を走らせる。
    document.addEventListener('click', (event) => void onDocumentClick(event), true);

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
        pendingObsidianNote = {
          original: text,
          english,
          kaisetsu,
          translatedAtIso: new Date().toISOString(),
          composer: lastComposer,
          saved: false,
          saving: false,
        };
        panel.render(state);
        void clearComposerForSuccess();
      } else {
        panel.render({ status: 'error', kind: response.error, message: response.message });
      }
    }

    /**
     * Xの投稿ボタンクリックを拾い、投稿成功後のObsidian保存フローへ渡す。
     * @param event - document capture phase のclickイベント。
     * @returns 処理完了時にresolveするPromise。
     * @example
     * await onDocumentClick(clickEvent) // => posts keep flowing while save runs later
     */
    async function onDocumentClick(event: MouseEvent): Promise<void> {
      const postButton = findPostButton(event.target);
      if (!postButton || isPostButtonDisabled(postButton)) return;
      if (!pendingObsidianNote || pendingObsidianNote.saved || pendingObsidianNote.saving) return;

      pendingObsidianNote.saving = true;
      const composerAtClick = activeComposer() ?? pendingObsidianNote.composer;
      const postedText =
        composerAtClick && !isComposerEmpty(composerAtClick)
          ? readComposerText(composerAtClick)
          : pendingObsidianNote.english;

      await sleep(POST_CLICK_SETTLE_DELAY_MS);
      const didPostSucceed = await waitForPostSuccess(composerAtClick, postButton);
      if (!didPostSucceed) {
        pendingObsidianNote.saving = false;
        return;
      }

      await savePendingObsidianNote(pendingObsidianNote, postedText, new Date().toISOString());
    }

    /**
     * クリック元からXの投稿ボタンを探し、document click監視から呼ばれる。
     * @param target - clickイベントの発火元。
     * @returns 投稿ボタンならHTMLElement、違えばnull。
     * @example
     * findPostButton(button.querySelector('span')) // => button element
     */
    function findPostButton(target: EventTarget | null): HTMLElement | null {
      if (!(target instanceof Element)) return null;
      const button = target.closest(`${SEL.postButton}, ${SEL.postButtonInline}`);
      return button instanceof HTMLElement ? button : null;
    }

    /**
     * Xの投稿ボタンが無効状態か判定し、空投稿や処理中クリックを保存対象から外す。
     * @param button - Xの投稿ボタン候補。
     * @returns disabled/aria-disabledならtrue。
     * @example
     * isPostButtonDisabled(button) // => false
     */
    function isPostButtonDisabled(button: HTMLElement): boolean {
      return button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true';
    }

    /**
     * 投稿後にコンポーザーが空/消滅するのを待ち、保存してよい成功状態か確認する。
     * @param composer - クリック時点の投稿欄。
     * @param button - クリックされた投稿ボタン。
     * @returns 成功と判断できたらtrue、timeoutならfalse。
     * @example
     * await waitForPostSuccess(composer, button) // => true
     */
    async function waitForPostSuccess(
      composer: HTMLElement | null,
      button: HTMLElement,
    ): Promise<boolean> {
      const startedAtMs = Date.now();
      while (Date.now() - startedAtMs < POST_SUCCESS_TIMEOUT_MS) {
        await sleep(POST_SUCCESS_POLL_INTERVAL_MS);

        // モーダル投稿では成功後にコンポーザーごとDOMから消える。
        if (composer && !composer.isConnected) return true;
        // インライン投稿では成功後に同じコンポーザーが空へ戻る。
        if (composer && isComposerEmpty(composer)) return true;
        // Xの再描画でボタンだけ先に消えた場合も、本文が残っていなければ成功扱いにする。
        if (!button.isConnected && (!composer || !composer.isConnected || isComposerEmpty(composer))) {
          return true;
        }
      }
      return false;
    }

    /**
     * 保持中の翻訳結果をbackgroundへ送り、投稿成功後のObsidian保存を1回だけ実行する。
     * @param pendingNote - 翻訳成功時に保持した保存候補。
     * @param postedText - 実際にXへ投稿された本文。
     * @param postedAtIso - 投稿成功と判断した時刻。
     * @returns 保存依頼完了時にresolveするPromise。
     * @example
     * await savePendingObsidianNote(note, 'Hello!', new Date().toISOString()) // => saves one note
     */
    async function savePendingObsidianNote(
      pendingNote: PendingObsidianNote,
      postedText: string,
      postedAtIso: string,
    ): Promise<void> {
      pendingNote.saving = true;
      pendingNote.saved = true;

      let response: ObsidianResponse;
      try {
        response = (await browser.runtime.sendMessage({
          type: 'SAVE_OBSIDIAN_NOTE',
          note: {
            original: pendingNote.original,
            english: pendingNote.english,
            postedText,
            kaisetsu: pendingNote.kaisetsu,
            pageUrl: location.href,
            translatedAtIso: pendingNote.translatedAtIso,
            postedAtIso,
          },
        })) as ObsidianResponse;
      } catch (error) {
        pendingNote.saving = false;
        console.warn('[transpost] Obsidian保存リクエストに失敗:', error);
        panel?.toast('Obsidian保存に失敗しました');
        return;
      }

      pendingNote.saving = false;
      if (response.ok) {
        panel?.toast('Obsidianに保存しました');
        return;
      }
      if (response.error === 'DISABLED') return;
      console.warn('[transpost] Obsidian保存に失敗:', response.message);
      panel?.toast('Obsidian保存に失敗しました');
    }

    /**
     * 指定時間だけ待機し、投稿成功pollingから呼ばれる。
     * @param milliseconds - 待機するミリ秒。
     * @returns 待機後にresolveするPromise。
     * @example
     * await sleep(250) // => resolves after 250ms
     */
    function sleep(milliseconds: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
