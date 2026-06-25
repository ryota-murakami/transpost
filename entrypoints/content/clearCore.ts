// Draft.js コンポーザーを実際に空にする「純DOM処理」と、isolated↔MAIN world ブリッジ用の定数。
// chrome/browser API に一切依存しないため、MAIN world の content script からも読み込める。
//
// 【なぜ world を分けるのか・2026-06-14 実機 E2E で確定】
// 合成 Backspace は Draft.js の editOnKeyDown へ届く必要があるが、その listener はページ(MAIN world)側にある。
// isolated world（既定の content script）から投げた KeyboardEvent は Draft に無視され、日本語が消えない。
// 同一コンポーザーで検証: AFTER_ISOLATED_CLEAR=日本語残存 / AFTER_MAIN_CLEAR="" → クリアは MAIN world で行う。
// isolated と MAIN の橋渡しは window.postMessage（CustomEvent は world をまたいで届かない）。
// ⚠️ performDraftClear の手順を変えたら verification/composer-clear.regression.mjs も手で同期すること
//    （同スクリプトはこの手順を実機 X 上で再現して健全性を検証するもの＝ソース連動の自動ガードではない）。

// isolated↔MAIN の通信は window.postMessage を使う（CustomEvent は world をまたがず届かないため）。
/** ブリッジの postMessage を x.com 自身の postMessage と区別する識別キー。 */
export const BRIDGE_MESSAGE_KEY = '__transpostClearBridge';
/** isolated→MAIN: クリア要求の種別値。 */
export const CLEAR_REQUEST = 'clear-request';
/** MAIN→isolated: クリア完了通知の種別値。 */
export const CLEAR_DONE = 'clear-done';
/** 対象コンポーザーを MAIN world へ受け渡すための目印属性（DOM は両 world 共有なので属性で受け渡せる）。 */
export const CLEAR_TARGET_ATTR = 'data-transpost-clear-target';
/** MAIN world からの完了通知を待つ上限(ms)。超過しても isolated 側で空判定にフォールバックする。 */
export const CLEAR_TIMEOUT_MS = 1500;

/**
 * focus 直後に待つ描画フレーム数。blur 状態から el.focus() した直後は Draft の focus 再レンダリングが
 * 未完で、全選択しても「エディタ外」を指して1文字しか消えない。2フレーム待つと選択コンテキストが確立する。
 */
const FOCUS_SETTLE_FRAMES = 2;

// 通常は1回目(delay=0)で空になるが、再描画/同期の取りこぼし保険として空になるまで待ち時間を
// 0→300→800ms と増やしつつ再試行する（実機 E2E では全ケース1回目で成功）。
const CLEAR_RETRY_DELAYS_MS = [0, 300, 800];

/**
 * 実時間 ms だけ待つ（rAF ではなく setTimeout）。Draft のモデル選択同期を待つために使う。
 * @param durationMs 待機ミリ秒
 * @returns 指定 ms 経過後に解決する Promise
 */
function sleep(durationMs: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}

/**
 * 指定フレーム数だけ待つ。focus 後に Draft の再レンダリングが落ち着くのを待つために使う。
 * @param frameCount 待機する requestAnimationFrame の回数
 * @returns 指定フレーム経過後に解決する Promise
 * @example await waitAnimationFrames(2) // 2フレーム待つ
 */
export function waitAnimationFrames(frameCount: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let remaining = frameCount;
    const tick = (): void => {
      remaining -= 1;
      // 残りフレームが尽きたら解決、まだ残っていれば次フレームへ
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * コンポーザーのプレーンテキストを取得。Draft のブロック境界は改行になる。
 * 末尾の余分な改行とゼロ幅スペースを除去する。
 * @param el 対象の Draft contenteditable 要素
 * @returns 余分な改行/ゼロ幅スペースを除いた可視テキスト
 */
export function readComposerText(el: HTMLElement): string {
  return (el.innerText ?? '').replace(/​/g, '').replace(/\n$/, '');
}

/**
 * コンポーザーが空かを判定する。テキスト基準（data-text span の有無は不可: クリア健全時は空 span が
 * 1個残り、入力/削除不能の壊れ状態では浮きテキストがあっても span が0個になり誤判定するため）。
 * @param el 対象の Draft contenteditable 要素
 * @returns 可視テキストが無ければ true、何か入力されていれば false
 * @example
 * isComposerEmpty(emptyComposer)      // => true
 * isComposerEmpty(composerWith日本語) // => false
 */
export function isComposerEmpty(el: HTMLElement): boolean {
  return readComposerText(el) === '';
}

/**
 * Draft の editOnKeyDown 経路へ合成 Backspace（keydown→keyup）を流す。フル選択中に呼べば
 * Draft が自身のモデル上で選択範囲を削除し、DOM と EditorState の同期を保ったまま空にできる。
 * @param editor フォーカス済みの contenteditable 本体（.public-DraftEditor-content）
 * @example dispatchBackspaceThroughDraft(editorEl)
 */
function dispatchBackspaceThroughDraft(editor: HTMLElement): void {
  // Draft は keyCode/which=8 で Backspace を判定するため両方付与する
  const eventInit: KeyboardEventInit = {
    key: 'Backspace',
    code: 'Backspace',
    keyCode: 8,
    which: 8,
    bubbles: true,
    cancelable: true,
  };
  editor.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  editor.dispatchEvent(new KeyboardEvent('keyup', eventInit));
}

/**
 * Draft の削除パイプラインを通してコンポーザーを空にする純DOM処理。focus→rAF待ち→全選択→
 * selectionchange 同期→合成 Backspace→再描画待ち の順。execCommand('delete') は EditorState を壊し
 * 以後入力不能になるため使わない。
 * 【対象は必ず contenteditable 本体・2026-06-14 実機 E2E で確定】X は同番号で非編集ラッパー
 * (tweetTextarea_0_label / tweetTextarea_0RichTextInputContainer) も持つ。祖先ラッパーへ Backspace を
 * 投げても Draft の editOnKeyDown（=本体に紐づく）へは届かずクリアが無反応になるため、本体へ解決してから操作する。
 * ⚠️ MAIN world でのみ有効（isolated world からの合成 Backspace は Draft に届かない）。
 * @param el 対象要素（contenteditable 本体、またはそれを内包するラッパー）
 * @returns 空になったら true（再描画前に読むため false でも実際は空のことがある＝ベストエフォート）
 * @example await performDraftClear(composerEl)
 */
export async function performDraftClear(el: HTMLElement): Promise<boolean> {
  // el がラッパーなら内側の contenteditable 本体へ解決する（祖先要素では Backspace が Draft に届かない）
  const editor = el.isContentEditable
    ? el
    : (el.querySelector<HTMLElement>('.public-DraftEditor-content') ?? el);

  // 各試行: focus → rAF待ち → 全選択 → selectionchange 同期 → Backspace。
  // 取りこぼし保険として待ち時間を 0→300→800ms と増やしながら空になるまで再試行する。
  for (let attempt = 1; attempt <= CLEAR_RETRY_DELAYS_MS.length; attempt += 1) {
    const syncDelayMs = CLEAR_RETRY_DELAYS_MS[attempt - 1];

    editor.focus();
    // focus 直後は選択コンテキストが未確立なので、Draft の再描画が落ち着くまで待つ
    await waitAnimationFrames(FOCUS_SETTLE_FRAMES);

    // エディタ内容全体を明示 Range で選択（selectAll の focus 依存ヒューリスティックを避ける）
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);

    // select / selectionchange を発火 → Draft の editOnSelect が EditorState.selection をフル範囲へ同期
    editor.dispatchEvent(new Event('select', { bubbles: true }));
    document.dispatchEvent(new Event('selectionchange'));
    // selectionchange が Draft のモデルへ反映されるのを実時間で待ってから Backspace（同期/rAFだと未反映で無視される）
    if (syncDelayMs > 0) await sleep(syncDelayMs);
    else await waitAnimationFrames(FOCUS_SETTLE_FRAMES);

    // 合成 Backspace で Draft 自身にフル選択を削除させる（DOM と EditorState の同期を保つ）
    dispatchBackspaceThroughDraft(editor);

    // 削除後の再描画を待ってから空判定（同期読みは未反映で false になりうる）
    await waitAnimationFrames(FOCUS_SETTLE_FRAMES);
    if (isComposerEmpty(editor)) return true;
  }
  // 全試行しても空にならなければ警告（X の DOM 変更等の早期検知用）
  const empty = isComposerEmpty(editor);
  if (!empty) console.warn('[transpost] コンポーザーのクリアに失敗しました（X の DOM 変更の可能性）。');
  return empty;
}
