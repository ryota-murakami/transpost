// 設定の型と chrome.storage.local 読み書き。APIキー/モデル/推論強度/システムプロンプトを保持。
// Zod は使わず、読み出し時に既定値とマージ＋型の軽いバリデーションで壊れた値を吸収する。

import { DEFAULT_SYSTEM_PROMPT } from './prompt';

/** 選択可能なモデル（設定 UI の select と対応）。既定は gpt-5.4。 */
export const MODELS = ['gpt-5.4', 'gpt-5.5', 'gpt-5.4-mini'] as const;
export type Model = (typeof MODELS)[number];

/** 推論強度。GPT-5 系は temperature 非対応なため、こちらで品質/速度を調整する。 */
export const EFFORTS = ['none', 'low', 'medium'] as const;
export type ReasoningEffort = (typeof EFFORTS)[number];

export interface Settings {
  apiKey: string;
  model: Model;
  reasoningEffort: ReasoningEffort;
  systemPrompt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'gpt-5.4',
  reasoningEffort: 'low',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

const STORAGE_KEY = 'transpost:settings';

/** 保存値を既定値とマージし、列挙値は不正なら既定へフォールバックして返す。 */
export async function loadSettings(): Promise<Settings> {
  const got = await browser.storage.local.get(STORAGE_KEY);
  const raw = (got?.[STORAGE_KEY] ?? {}) as Partial<Settings>;
  return {
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : DEFAULT_SETTINGS.apiKey,
    model: MODELS.includes(raw.model as Model)
      ? (raw.model as Model)
      : DEFAULT_SETTINGS.model,
    reasoningEffort: EFFORTS.includes(raw.reasoningEffort as ReasoningEffort)
      ? (raw.reasoningEffort as ReasoningEffort)
      : DEFAULT_SETTINGS.reasoningEffort,
    systemPrompt:
      typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim()
        ? raw.systemPrompt
        : DEFAULT_SETTINGS.systemPrompt,
  };
}

/** 設定を保存。 */
export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: settings });
}
