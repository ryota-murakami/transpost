import { readComposerText } from './clearCore';
import { getMatchingPrefixLength } from './utils/getMatchingPrefixLength';

export interface TypingPracticeCallbacks {
  /**
   * Updates the English guide after composer input; the typing-practice controller calls it for every relevant edit.
   * @param matchedCharacterCount - Number of correct leading guide characters.
   * @returns Nothing.
   * @example
   * onProgress(3) // => the first three guide characters become gray
   */
  onProgress(matchedCharacterCount: number): void;
  /**
   * Starts the completion effect after an exact match; the typing-practice controller calls it once per translation.
   * @returns Nothing.
   * @example
   * onComplete() // => fires the completion confetti
   */
  onComplete(): void;
}

export interface TypingPractice {
  /**
   * Clears an obsolete typing target before loading or errors; the translation flow calls it when a new attempt starts.
   * @returns Nothing.
   * @example
   * typingPractice.reset() // => later composer input is ignored
   */
  reset(): void;
  /**
   * Begins tracking a translated guide; the successful translation flow calls it before the user starts typing.
   * @param targetText - Translated English shown in the panel.
   * @param composer - X contenteditable that receives the retyped English.
   * @returns Nothing.
   * @example
   * typingPractice.start('Hello', composer)
   */
  start(targetText: string, composer: HTMLElement): void;
  /**
   * Processes delegated composer edits; the document input listener calls it while a typing target is active.
   * @param event - Bubbling input event from X.
   * @returns Nothing.
   * @example
   * typingPractice.handleInput(new InputEvent('input'))
   */
  handleInput(event: Event): void;
}

/**
 * Creates one translation-scoped typing controller so document input can update progress and celebrate exactly once.
 * @param callbacks - Panel progress and completion effects invoked by the controller.
 * @returns Controller used by the content-script translation and input flows.
 * @example
 * const typingPractice = createTypingPractice({ onProgress, onComplete })
 */
export function createTypingPractice(callbacks: TypingPracticeCallbacks): TypingPractice {
  let targetText = '';
  let composer: HTMLElement | null = null;
  let didCelebrateCompletion = false;

  /**
   * Clears the current session so stale input cannot complete an older translation; the translation flow calls it on restart.
   * @returns Nothing.
   * @example
   * reset() // => input is ignored until start() runs again
   */
  function reset(): void {
    targetText = '';
    composer = null;
    didCelebrateCompletion = false;
  }

  /**
   * Replaces the current session after translation succeeds; the content script passes the guide and its original composer.
   * @param nextTargetText - New translated guide.
   * @param nextComposer - Composer cleared for typing practice.
   * @returns Nothing.
   * @example
   * start('Hello', composer)
   */
  function start(nextTargetText: string, nextComposer: HTMLElement): void {
    targetText = nextTargetText;
    composer = nextComposer;
    didCelebrateCompletion = false;
  }

  /**
   * Applies an X input event to the active session; the delegated document listener calls it after every composer edit.
   * @param event - Input event whose target must belong to the tracked composer.
   * @returns Nothing.
   * @example
  * handleInput(inputEvent) // => reports the current correct prefix
   */
  function handleInput(event: Event): void {
    // Ignore page input until a successful translation supplies both a guide and its composer.
    if (!targetText || !composer) return;
    const inputTarget = event.target;
    // Browser events without a DOM target cannot belong to the tracked contenteditable.
    if (!(inputTarget instanceof Node)) return;

    // Ignore other X composers so an inline draft cannot advance a modal translation, or vice versa.
    if (inputTarget !== composer && !composer.contains(inputTarget)) return;

    const typedText = readComposerText(composer);
    const matchedCharacterCount = getMatchingPrefixLength(typedText, targetText);
    callbacks.onProgress(matchedCharacterCount);

    // Equal lengths prevent an extra trailing character from completing a merely matching prefix.
    const didTypeEntireTarget =
      typedText.length === targetText.length && matchedCharacterCount === targetText.length;
    // A completed guide rewards the first exact match only, even if the user edits and retypes it.
    if (!didTypeEntireTarget || didCelebrateCompletion) return;

    didCelebrateCompletion = true;
    callbacks.onComplete();
  }

  return { reset, start, handleInput };
}
