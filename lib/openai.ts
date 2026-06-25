// OpenAI Chat Completions 呼び出しとエラー分類。background service worker から実行する
// （host_permissions: api.openai.com により CORS を回避）。GPT-5 系は temperature 非対応のため
// reasoning_effort で制御し、上限トークンは max_completion_tokens を使う。

import type { Settings } from './storage';
import type { TranslateErrorKind, TranslateResponse } from './messages';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MAX_COMPLETION_TOKENS = 4000; // 解説が複数段落でも途中で切れないよう余裕を持たせる
const RETRY_DELAYS_MS = [1200, 3000]; // RATE_LIMIT/SERVER の指数的バックオフ（最大2回再試行）

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ステータス/エラーボディからユーザー向けメッセージへ分類する。 */
function classify(status: number, code?: string): {
  error: TranslateErrorKind;
  message: string;
} {
  if (status === 401)
    return { error: 'INVALID_KEY', message: 'APIキーが無効です。設定画面で再入力してください。' };
  if (status === 404 || (status === 400 && code === 'model_not_found'))
    return {
      error: 'MODEL_NOT_FOUND',
      message: 'モデルが見つかりません。設定でモデルを変更してください。',
    };
  if (status === 429 && code === 'insufficient_quota')
    return { error: 'QUOTA', message: 'OpenAIの利用枠を使い切りました。請求/プランを確認してください。' };
  if (status === 429)
    return { error: 'RATE_LIMIT', message: 'リクエストが集中しています。少し待って再試行してください。' };
  if (status === 500 || status === 503)
    return { error: 'SERVER', message: 'OpenAIサーバーが混雑しています。後でもう一度お試しください。' };
  return { error: 'UNKNOWN', message: `翻訳に失敗しました (${status})。` };
}

/** 設定と日本語テキストを受け取り、英訳＋解説テキストを返す。失敗時は分類済みエラー。 */
export async function translate(
  settings: Settings,
  japaneseText: string,
): Promise<TranslateResponse> {
  if (!settings.apiKey) {
    return { ok: false, error: 'NO_KEY', message: 'OpenAI APIキーが設定されていません。' };
  }

  const body = JSON.stringify({
    model: settings.model,
    reasoning_effort: settings.reasoningEffort, // temperature は送らない（GPT-5系で400になる）
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    messages: [
      { role: 'developer', content: settings.systemPrompt }, // 'system' も可。5系は developer が現行
      { role: 'user', content: japaneseText },
    ],
  });

  // RATE_LIMIT/SERVER のみ指数バックオフで再試行。それ以外は即時返す。
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      });
    } catch {
      return { ok: false, error: 'NETWORK', message: 'ネットワークに接続できません。接続を確認してください。' };
    }

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const content: unknown = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return { ok: true, content };
      }
      return { ok: false, error: 'UNKNOWN', message: '空の応答が返りました。もう一度お試しください。' };
    }

    const errBody = await res.json().catch(() => ({}));
    const code: string | undefined = errBody?.error?.code;
    const { error, message } = classify(res.status, code);

    const retryable = error === 'RATE_LIMIT' || error === 'SERVER';
    if (retryable && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    return { ok: false, error, message };
  }
}
