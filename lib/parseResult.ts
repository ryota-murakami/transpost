// AI 応答（英訳に続いて「【解説】」ブロックが0個以上）を、英訳本文と解説配列に分割する。

export interface ParsedResult {
  /** 先頭の英訳本文。 */
  english: string;
  /** 「【解説】」見出しごとに分割した解説ブロック（0個以上）。 */
  kaisetsu: string[];
}

/**
 * 「【解説】」（前後の空白を許容）で分割。先頭塊=英訳、以降の各塊=解説。
 * マーカーが無い場合は全体を英訳として扱う。
 * @example parseResult('Hello.\n【解説】\n"Hello" は…') -> { english:'Hello.', kaisetsu:['"Hello" は…'] }
 */
export function parseResult(raw: string): ParsedResult {
  const parts = raw.split(/【\s*解説\s*】/);
  const english = (parts.shift() ?? '').trim();
  const kaisetsu = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return { english, kaisetsu };
}
