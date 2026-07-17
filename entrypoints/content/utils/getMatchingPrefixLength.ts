const TYPING_CHARACTER_EQUIVALENTS: Readonly<Record<string, string>> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u00a0': ' ',
};

/**
 * Counts the correct leading guide characters after each composer input so typing practice stops at the first mistake.
 * @param typedText - Text currently entered in the X composer.
 * @param targetText - Translated English displayed by the panel.
 * @returns Number of leading target characters that are correctly typed.
 * @example
 * getMatchingPrefixLength("didn't", 'didn\u2019t') // => 6
 */
export function getMatchingPrefixLength(typedText: string, targetText: string): number {
  const comparableCharacterCount = Math.min(typedText.length, targetText.length);
  let matchedCharacterCount = 0;

  // Stop at the first different character so a later match cannot skip over an earlier typo.
  while (matchedCharacterCount < comparableCharacterCount) {
    const typedCharacter = typedText.charAt(matchedCharacterCount);
    const targetCharacter = targetText.charAt(matchedCharacterCount);
    const comparableTypedCharacter = TYPING_CHARACTER_EQUIVALENTS[typedCharacter] ?? typedCharacter;
    const comparableTargetCharacter = TYPING_CHARACTER_EQUIVALENTS[targetCharacter] ?? targetCharacter;
    if (comparableTypedCharacter !== comparableTargetCharacter) break;
    matchedCharacterCount += 1;
  }

  return matchedCharacterCount;
}
