// 設定の型と chrome.storage.local 読み書き。APIキー/モデル/推論強度/システムプロンプトを保持。
// Zod は使わず、読み出し時に既定値とマージ＋型の軽いバリデーションで壊れた値を吸収する。

import { OBSIDIAN_DEFAULT_API_URL } from './constants';
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
  obsidianEnabled: boolean;
  obsidianApiUrl: string;
  obsidianApiKey: string;
  obsidianOutputFolder: string;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'gpt-5.4',
  reasoningEffort: 'low',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  obsidianEnabled: false,
  obsidianApiUrl: OBSIDIAN_DEFAULT_API_URL,
  obsidianApiKey: '',
  obsidianOutputFolder: '',
};

const STORAGE_KEY = 'transpost:settings';

/**
 * 保存値を既定値とマージし、options/background/contentから壊れた設定を読んでも復元する。
 * @returns バリデーション済みのSettings。
 * @example
 * await loadSettings() // => { apiKey: '', model: 'gpt-5.4', ... }
 */
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
    obsidianEnabled:
      typeof raw.obsidianEnabled === 'boolean'
        ? raw.obsidianEnabled
        : DEFAULT_SETTINGS.obsidianEnabled,
    obsidianApiUrl:
      typeof raw.obsidianApiUrl === 'string' && raw.obsidianApiUrl.trim()
        ? raw.obsidianApiUrl.trim()
        : DEFAULT_SETTINGS.obsidianApiUrl,
    obsidianApiKey:
      typeof raw.obsidianApiKey === 'string'
        ? raw.obsidianApiKey
        : DEFAULT_SETTINGS.obsidianApiKey,
    obsidianOutputFolder:
      typeof raw.obsidianOutputFolder === 'string'
        ? raw.obsidianOutputFolder.trim()
        : DEFAULT_SETTINGS.obsidianOutputFolder,
  };
}

/**
 * 設定をchrome.storage.localへ保存し、optionsページのsubmitから呼ばれる。
 * @param settings - 保存するSettings。
 * @returns 保存完了時にresolveするPromise。
 * @example
 * await saveSettings(DEFAULT_SETTINGS) // => resolves when storage.local is updated
 */
export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: settings });
}
