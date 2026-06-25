// 設定ページのロジック: 保存済み設定の読み込み → フォーム反映 → 保存 / プロンプト初期化 / キー表示切替。
// chrome.storage.local を lib/storage.ts のラッパ経由で読み書きする（Zod 不使用、軽いバリデーションは storage 側）。

import {
  loadSettings,
  saveSettings,
  MODELS,
  EFFORTS,
  type Settings,
  type Model,
  type ReasoningEffort,
} from '@/lib/storage';
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/prompt';

/** 型付きで要素を取得（存在しなければ即例外＝HTML との不整合を早期検知）。 */
function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`[transpost] 要素が見つかりません: #${id}`);
  return found as T;
}

const form = el<HTMLFormElement>('settings-form');
const apiKeyInput = el<HTMLInputElement>('api-key');
const toggleKeyBtn = el<HTMLButtonElement>('toggle-key');
const modelSelect = el<HTMLSelectElement>('model');
const effortSelect = el<HTMLSelectElement>('effort');
const promptTextarea = el<HTMLTextAreaElement>('system-prompt');
const resetPromptBtn = el<HTMLButtonElement>('reset-prompt');
const statusEl = el<HTMLSpanElement>('status');

/** select に option 群を流し込む共通処理。 */
function fillOptions(select: HTMLSelectElement, values: readonly string[]): void {
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

/** 保存済み設定をフォームへ反映。 */
function applyToForm(settings: Settings): void {
  apiKeyInput.value = settings.apiKey;
  modelSelect.value = settings.model;
  effortSelect.value = settings.reasoningEffort;
  promptTextarea.value = settings.systemPrompt;
}

/** 一時的なステータス表示（保存完了など）。 */
let statusTimer: ReturnType<typeof setTimeout> | undefined;
function showStatus(message: string, kind: 'ok' | 'error' = 'ok'): void {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.textContent = '';
    delete statusEl.dataset.kind;
  }, 2600);
}

// ── 初期化 ───────────────────────────────
fillOptions(modelSelect, MODELS);
fillOptions(effortSelect, EFFORTS);
applyToForm(await loadSettings());

// ── キー表示/非表示トグル ───────────────────────────────
toggleKeyBtn.addEventListener('click', () => {
  const willShow = apiKeyInput.type === 'password';
  apiKeyInput.type = willShow ? 'text' : 'password';
  toggleKeyBtn.textContent = willShow ? '隠す' : '表示';
  toggleKeyBtn.setAttribute('aria-pressed', String(willShow));
});

// ── プロンプトを既定に戻す ───────────────────────────────
resetPromptBtn.addEventListener('click', () => {
  promptTextarea.value = DEFAULT_SYSTEM_PROMPT;
  showStatus('システムプロンプトを既定に戻しました');
});

// ── 保存 ───────────────────────────────
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const settings: Settings = {
    apiKey: apiKeyInput.value.trim(),
    model: modelSelect.value as Model,
    reasoningEffort: effortSelect.value as ReasoningEffort,
    // 空欄なら既定値で保存（storage 側でも吸収するが UI でも明示）。
    systemPrompt: promptTextarea.value.trim() || DEFAULT_SYSTEM_PROMPT,
  };
  try {
    await saveSettings(settings);
    // 保存値（空→既定の置換）をフォームへ反映し直す。
    applyToForm(settings);
    showStatus('保存しました ✅');
  } catch (error) {
    showStatus('保存に失敗しました', 'error');
    console.error('[transpost] 設定の保存に失敗:', error);
  }
});
