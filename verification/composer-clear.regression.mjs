// 回帰テスト（手動・ログイン必須）: 「翻訳後にオリジナル投稿を消すと、以後 Post Editor で
// 入力も削除もできなくなる」バグの再発防止。
//
// バグの根本原因: 旧 clearComposer は execCommand('selectAll')+execCommand('delete') を使い、
// Draft.js の EditorState を DOM と乖離させていた。結果、エディタが「ゾンビ化」して
// 生のキー入力は innerText に乗るが Draft がモデルへ反映せず、Backspace も効かなくなる。
//
// 修正: focus → rAF×2待ち（選択コンテキスト確立）→ 内容全選択 → selectionchange 発火で
// Draft の EditorState.selection をフル範囲へ同期 → 合成 Backspace を Draft のモデルへ流す。
//
// 追加で判明した根本原因（2026-06-14 実機 E2E）: 操作対象は必ず contenteditable 本体
// (.public-DraftEditor-content) でなければならない。X は同番号で非編集ラッパー
// (tweetTextarea_0_label / tweetTextarea_0RichTextInputContainer) も持ち、祖先ラッパーへ Backspace を
// 投げても Draft の editOnKeyDown へ届かずクリアが無反応になる。本番では activeComposer が
// isContentEditable で本体に絞り、performDraftClear も内側の本体へ解決してから操作する。
//
// ⚠️ これは「機構検証＋手動再実行」アーティファクトであり、ソース連動の自動ガードではない。
// 拡張をロードできない事情のため、clearComposer を直接呼ばずに同じ手順を page world に複製して
// 実機 X 上で再現・検証する。つまり composer.ts に execCommand('delete') が再混入しても本テストは
// 素通りする。composer.ts の clearComposer を変更したら、この複製ロジックも必ず手で同期すること。
//
// 前提:
//   1) `/cookie` スキルで Chrome cookie を取り込んだ persistent な playwright-cli セッションが起動済み
//      （playwright-cli open --persistent → run-code で /tmp/chrome-load-cookies.js をロード）。
//   2) x.com にログイン済み。
// 実行:
//   playwright-cli run-code --filename=verification/composer-clear.regression.mjs
// 期待: 返り値 JSON の summary.allPassed === true
//   （pristine ゲート / focused 経路 / blurred 経路 / single-line 経路 すべてで健全）。
async (page) => {
  const SEL = '[data-testid="tweetTextarea_0"]';
  page.on('dialog', (d) => d.accept().catch(() => {}));

  // dirty な composer での reload が beforeunload ダイアログで playwright-cli を固めるのを防ぐ
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'onbeforeunload', { configurable: true, get: () => null, set: () => {} });
    } catch {}
    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) {
      if (type === 'beforeunload') return;
      return orig.call(this, type, ...rest);
    };
  });

  const capture = async () =>
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (!el) return { exists: false };
      const dt = [...el.querySelectorAll('[data-text="true"]')];
      const text = el.innerText.replace(/​/g, '').replace(/\n$/, '');
      return { text, len: text.length, dataTextCount: dt.length, empty: text === '' };
    });

  // entrypoints/content/composer.ts の clearComposer と同一手順を page world で実行
  const clearComposer = async () =>
    await page.evaluate(async () => {
      // performDraftClear と同じく、対象が非編集ラッパーなら contenteditable 本体へ解決する
      const raw = document.querySelector('[data-testid="tweetTextarea_0"]');
      const el = raw.isContentEditable ? raw : raw.querySelector('.public-DraftEditor-content') ?? raw;
      const waitFrames = (n) =>
        new Promise((resolve) => {
          let remaining = n;
          const tick = () => {
            remaining -= 1;
            if (remaining <= 0) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      el.focus();
      await waitFrames(2); // focus 後に Draft の再描画を待つ（未確立だと1文字しか消えない）
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      el.dispatchEvent(new Event('select', { bubbles: true }));
      document.dispatchEvent(new Event('selectionchange')); // Draft の selection をフル範囲へ同期
      const init = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', init)); // Draft のモデル上でフル選択を削除
      el.dispatchEvent(new KeyboardEvent('keyup', init));
      await waitFrames(2);
    });

  const typeMultilineJapanese = async () => {
    await page.reload();
    await page.waitForSelector(SEL, { timeout: 15000 });
    await page.locator(SEL).first().click();
    await page.waitForTimeout(250);
    await page.keyboard.type('明日は友達と渋谷で会う予定です');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('楽しみすぎる');
    await page.waitForTimeout(350);
  };

  // 単一行（実際の下書きで最も多い形）。複数行とは Draft のブロック構造が異なるため別途検証する。
  const typeSingleLineJapanese = async () => {
    await page.reload();
    await page.waitForSelector(SEL, { timeout: 15000 });
    await page.locator(SEL).first().click();
    await page.waitForTimeout(250);
    await page.keyboard.type('明日は友達と渋谷で会う予定です');
    await page.waitForTimeout(350);
  };

  // クリア後の健全性: 入力できる & Backspace で削除できる
  const workoutAfterClear = async () => {
    await page.keyboard.type('Hello');
    await page.waitForTimeout(250);
    const afterType = await capture();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(250);
    const afterBackspace = await capture();
    return {
      afterType,
      afterBackspace,
      // 「入力できる」= Hello が乗る / 「削除できる」= Backspace×2 で Hel になる
      canType: afterType.text === 'Hello',
      canDelete: afterBackspace.text === 'Hel',
    };
  };

  const results = {};

  // --- ゲート: pristine（未入力）は空判定 true ---
  await page.reload();
  await page.waitForSelector(SEL, { timeout: 15000 });
  await page.locator(SEL).first().click();
  await page.waitForTimeout(300);
  const pristine = await capture();
  results.pristineEmptyGate = { capture: pristine, passed: pristine.empty === true };

  // --- 経路A: focused（ショートカット起動相当・フォーカスは composer に残る）---
  await typeMultilineJapanese();
  await clearComposer();
  const aCleared = await capture();
  const aWorkout = await workoutAfterClear();
  results.focusedPath = {
    afterClear: aCleared,
    workout: aWorkout,
    passed: aCleared.empty && aCleared.dataTextCount === 1 && aWorkout.canType && aWorkout.canDelete,
  };

  // --- 経路B: blurred（ツールバーアイコン起動相当・focus が外れて数秒経過後にクリア）---
  await typeMultilineJapanese();
  await page.evaluate(() => document.querySelector('[data-testid="tweetTextarea_0"]').blur());
  await page.waitForTimeout(1500);
  await clearComposer();
  const bCleared = await capture();
  const bWorkout = await workoutAfterClear();
  results.blurredPath = {
    afterClear: bCleared,
    workout: bWorkout,
    passed: bCleared.empty && bCleared.dataTextCount === 1 && bWorkout.canType && bWorkout.canDelete,
  };

  // --- 経路C: single-line（最も多い実下書きの形・focused でクリア）---
  await typeSingleLineJapanese();
  await clearComposer();
  const cCleared = await capture();
  const cWorkout = await workoutAfterClear();
  results.singleLinePath = {
    afterClear: cCleared,
    workout: cWorkout,
    passed: cCleared.empty && cCleared.dataTextCount === 1 && cWorkout.canType && cWorkout.canDelete,
  };

  results.summary = {
    allPassed:
      results.pristineEmptyGate.passed &&
      results.focusedPath.passed &&
      results.blurredPath.passed &&
      results.singleLinePath.passed,
  };

  return JSON.stringify(results, null, 2);
}
