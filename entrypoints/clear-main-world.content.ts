// MAIN world（ページと同じ JS 文脈）で動く content script。唯一の役割は Draft.js コンポーザーのクリア。
// isolated world の content script(entrypoints/content/index.ts) から postMessage(CLEAR_REQUEST) を受け、
// 目印属性の付いたコンポーザーへ合成 Backspace を流して Draft 自身に削除させ、完了を postMessage(CLEAR_DONE) で返す。
//
// 【なぜ MAIN world が必須か・2026-06-14 実機 E2E で確定】
// 合成 Backspace は Draft の editOnKeyDown(=ページ側 listener) へ届く必要がある。isolated world から投げると
// 無視され日本語が消えない（同一コンポーザーで AFTER_ISOLATED_CLEAR=日本語残存 / AFTER_MAIN_CLEAR="" を確認）。
// browser が直接注入する world:'MAIN' スクリプトはページ CSP の影響を受けない（注入 <script> は X の CSP で弾かれる）。
// isolated↔MAIN の橋渡しは window.postMessage（CustomEvent は world をまたいで届かない）。

import { SEL } from '@/lib/selectors';
import { BRIDGE_MESSAGE_KEY, CLEAR_DONE, CLEAR_REQUEST, CLEAR_TARGET_ATTR, performDraftClear } from './content/clearCore';

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  world: 'MAIN', // ページと同じ JS 文脈で実行（合成 Backspace を Draft に届けるため必須）
  runAt: 'document_start', // isolated 側がいつ要求しても受けられるよう、早期に listener を張る
  main() {
    // isolated → MAIN のクリア要求(postMessage)を受信
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      if ((event.data as Record<string, unknown> | null)?.[BRIDGE_MESSAGE_KEY] !== CLEAR_REQUEST) return;
      void handleClearRequest();
    });

    /** 目印属性の付いたコンポーザーを Draft の削除経路で空にし、完了を isolated 側へ返す。 */
    async function handleClearRequest(): Promise<void> {
      // isolated 側が付けた目印属性で対象を特定（万一無ければ最初の可視コンポーザーへフォールバック）
      const target =
        document.querySelector<HTMLElement>(`[${CLEAR_TARGET_ATTR}]`) ??
        document.querySelector<HTMLElement>(SEL.composer);
      if (target) await performDraftClear(target);
      // isolated 側へ完了通知（postMessage は world をまたいで届く）
      window.postMessage({ [BRIDGE_MESSAGE_KEY]: CLEAR_DONE }, '*');
    }
  },
});
