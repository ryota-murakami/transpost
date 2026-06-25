// X(Twitter) の Draft.js 投稿コンポーザーの特定/読み取り/クリア（isolated world 側）。
// 読み取り(readComposerText/isComposerEmpty)と実削除手順(performDraftClear)は clearCore.ts に集約し、
// 実削除は MAIN world の content script(entrypoints/clear-main-world.content.ts)へ委譲する。
//
// 【なぜ委譲するのか・2026-06-14 実機 E2E で確定】
// 合成 Backspace は Draft の editOnKeyDown(=MAIN world) へ届く必要がある。isolated world から投げると
// 無視され日本語が消えない（同一コンポーザーで AFTER_ISOLATED_CLEAR=日本語残存 / AFTER_MAIN_CLEAR="" を確認）。
// よって clearComposer はここでは「対象を目印付け→MAIN world へ要求→完了待ち」のブリッジに徹する。

import { SEL } from '@/lib/selectors';
import {
  BRIDGE_MESSAGE_KEY,
  CLEAR_DONE,
  CLEAR_REQUEST,
  CLEAR_TARGET_ATTR,
  CLEAR_TIMEOUT_MS,
  isComposerEmpty,
} from './clearCore';

// 読み取り系は clearCore に定義（MAIN world とも共有）。既存 import 元(./composer)を保つため再エクスポート。
export { isComposerEmpty, readComposerText } from './clearCore';

/**
 * ユーザーが実際に編集中のコンポーザーを特定する。
 * 優先: (1) フォーカス中の要素を含むもの → (2) 開いているモーダル内 → (3) 最初の可視コンポーザー。
 * （/compose/post ではモーダルと背後インラインで tweetTextarea_0 が2個共存するため必要）
 * @returns 対象の contenteditable 要素、無ければ null
 */
export function activeComposer(): HTMLElement | null {
  // 可視かつ contenteditable 本体のみ（_label / RichTextInputContainer 等の非編集ラッパーを除外）。
  // ラッパーを返すと合成 Backspace が祖先要素へ向き Draft の editOnKeyDown に届かずクリアが効かない。
  const all = [...document.querySelectorAll<HTMLElement>(SEL.composer)].filter(
    (el) => el.offsetParent !== null && el.isContentEditable,
  );
  const focused = all.find(
    (el) => el === document.activeElement || el.contains(document.activeElement),
  );
  if (focused) return focused;

  // モーダル内も同様に contenteditable 本体へ絞る
  const dialog = document.querySelector(SEL.dialog);
  const inDialog = [...(dialog?.querySelectorAll<HTMLElement>(SEL.composer) ?? [])].find(
    (el) => el.isContentEditable,
  );
  if (inDialog) return inDialog;

  return all[0] ?? null;
}

/**
 * コンポーザーを空にする。実削除（合成 Backspace）は Draft と同じ MAIN world でしか効かないため、
 * 対象に目印属性を付けて MAIN world の content script へ委譲し、完了通知(または timeout)を待ってから空判定する。
 * 翻訳成功後に呼ばれ、ユーザーが英訳を再入力できる状態にする。
 * @param el 対象の Draft contenteditable 要素
 * @returns 空になったら true（MAIN world 応答前に読むと false でも実際は空のことがある＝ベストエフォート）
 * @example await clearComposer(activeComposer()!)
 */
export async function clearComposer(el: HTMLElement): Promise<boolean> {
  // Lexical へ移行していたらこのキー経路は効かない可能性 → 警告のみ（将来の防御）
  if (el.matches(SEL.lexicalEditor)) {
    console.warn('[transpost] エディタが Lexical に変わった可能性。clear 手法の見直しが必要です。');
  }

  // DOM は両 world で共有されるので、目印属性で対象を MAIN world へ受け渡す
  el.setAttribute(CLEAR_TARGET_ATTR, '1');

  // MAIN world の完了通知(postMessage)を待つ。timeout しても下の空判定にフォールバックする。
  const waitForDone = new Promise<void>((resolve) => {
    const onMessage = (event: MessageEvent): void => {
      // 自ウィンドウ発・ブリッジ識別キー付き・完了種別のみ受理（x.com 自身の postMessage を無視）
      if (event.source !== window) return;
      if ((event.data as Record<string, unknown> | null)?.[BRIDGE_MESSAGE_KEY] !== CLEAR_DONE) return;
      window.removeEventListener('message', onMessage);
      resolve();
    };
    window.addEventListener('message', onMessage);
    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve();
    }, CLEAR_TIMEOUT_MS);
  });

  // MAIN world content script へクリアを要求（postMessage は world をまたいで届く）
  window.postMessage({ [BRIDGE_MESSAGE_KEY]: CLEAR_REQUEST }, '*');
  await waitForDone;

  el.removeAttribute(CLEAR_TARGET_ATTR);
  // DOM 読み取りは world をまたいで正しく読めるため、最終的な空判定は isolated 側で行う
  return isComposerEmpty(el);
}
