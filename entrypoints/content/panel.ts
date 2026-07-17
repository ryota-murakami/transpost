// 右端の常駐パネル（素の DOM）。状態(loading/success/error)に応じて本文を再描画する。
// × を押すまで閉じない（Esc・外側クリックでは閉じない＝仕様）。コピーボタンとトーストを内蔵。

import { ICONS, iconEl } from './icons';
import confetti from 'canvas-confetti';
import {
  TYPING_CONFETTI_ORIGIN_Y_RATIO,
  TYPING_CONFETTI_PARTICLE_COUNT,
  TYPING_CONFETTI_SPREAD_DEGREES,
  TYPING_CONFETTI_START_VELOCITY,
} from '../../lib/constants';
import type { TranslateErrorKind } from '@/lib/messages';

export type PanelState =
  | { status: 'loading'; original: string }
  | { status: 'success'; original: string; english: string; kaisetsu: string[] }
  | { status: 'error'; kind: TranslateErrorKind; message: string };

export interface PanelCallbacks {
  onClose(): void;
  onCopy(text: string): void;
  onRetry(): void;
  onOpenSettings(): void;
}

export interface PanelHandle {
  show(): void;
  hide(): void;
  render(state: PanelState): void;
  toast(message: string): void;
  /**
   * Updates the gray correct prefix after composer input; the typing-practice controller calls it for each edit.
   * @param matchedCharacterCount - Number of correct leading English characters.
   * @returns Nothing.
   * @example
   * panel.updateTypingProgress(4) // => the first four characters become gray
   */
  updateTypingProgress(matchedCharacterCount: number): void;
  /**
   * Fires the completion reward after an exact translation match; the typing-practice controller calls it once per guide.
   * @returns Nothing.
   * @example
   * panel.celebrate() // => launches a reduced-motion-aware confetti burst
   */
  celebrate(): void;
}

type Child = Node | string | null | undefined;
type Attrs = Record<string, string | ((e: Event) => void)>;

/** 最小ハイパースクリプト。on* で属性指定するとイベントリスナを張る。テキストは textContent 経由で安全。 */
function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') {
      el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = v;
    } else {
      el.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** エラー種別ごとのアクション出し分け。 */
const SETTINGS_KINDS: TranslateErrorKind[] = ['NO_KEY', 'INVALID_KEY', 'MODEL_NOT_FOUND'];
const RETRY_KINDS: TranslateErrorKind[] = ['RATE_LIMIT', 'SERVER', 'NETWORK', 'UNKNOWN'];

/**
 * Mounts the persistent translation panel and reward canvas when WXT creates the Shadow DOM UI.
 * @param container - Shadow-root container that isolates the panel from X styles.
 * @param callbacks - Close, copy, retry, and settings callbacks owned by the content script.
 * @returns Handle used by translation, typing, and toast flows.
 * @example
 * const panel = mountPanel(container, callbacks)
 */
export function mountPanel(container: HTMLElement, callbacks: PanelCallbacks): PanelHandle {
  // Keep one canvas for the panel lifetime so each completion reuses and cleanly resets the same renderer.
  const confettiCanvas = document.createElement('canvas');
  confettiCanvas.className = 'tp-confetti';
  confettiCanvas.setAttribute('aria-hidden', 'true');
  container.append(confettiCanvas);
  const launchConfetti = confetti.create(confettiCanvas, {
    resize: true,
    useWorker: false,
    disableForReducedMotion: true,
  });

  const body = h('div', { class: 'tp-body' });
  const header = h(
    'header',
    { class: 'tp-header' },
    h('h2', { class: 'tp-title' }, '英訳と解説'),
    h(
      'button',
      {
        class: 'tp-close',
        type: 'button',
        'aria-label': '閉じる',
        onclick: () => callbacks.onClose(),
      },
      iconEl('close'),
    ),
  );
  const panel = h(
    'aside',
    {
      class: 'tp-panel',
      'data-state': 'closed',
      role: 'complementary',
      'aria-label': 'transpost 英訳パネル',
    },
    header,
    body,
  );
  container.append(panel);

  const toastEl = h('div', { class: 'tp-toast', role: 'status', 'aria-live': 'polite' });
  container.append(toastEl);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let renderedEnglish = '';
  let completedEnglishElement: HTMLElement | null = null;
  let remainingEnglishElement: HTMLElement | null = null;

  /**
   * Preserves the removed Japanese draft in every non-error result; loading and success views call it as a safety copy.
   * @param original - Japanese source text removed from the X composer after translation.
   * @returns Card containing the original draft.
   * @example
   * originalCard('こんにちは') // => Japanese safety-copy card
   */
  function originalCard(original: string): HTMLElement {
    // 翻訳元の日本語。入力欄からは消えるためここが唯一の控え（安全網）。常時表示。
    return h(
      'section',
      { class: 'tp-card tp-original' },
      h('div', { class: 'tp-section-head' }, h('span', { class: 'tp-badge' }, 'あなたの日本語')),
      h('div', { class: 'tp-text' }, original),
    );
  }

  /**
   * Builds the translation placeholder while the background request runs; render calls it for loading state.
   * @param original - Japanese source text retained beneath the loading indicator.
   * @returns Loading stack with skeletons and the original-text card.
   * @example
   * loadingView('こんにちは') // => loading panel content
   */
  function loadingView(original: string): HTMLElement {
    const wrap = h('div', { class: 'tp-stack' });
    wrap.append(
      h('div', { class: 'tp-loading-row' }, iconEl('loader', 'tp-icon tp-spinner'), '英訳しています…'),
      originalCard(original),
      h('div', { class: 'tp-skeleton-block' }),
      h('div', { class: 'tp-skeleton', style: 'width:100%' }),
      h('div', { class: 'tp-skeleton', style: 'width:92%' }),
      h('div', { class: 'tp-skeleton', style: 'width:68%' }),
      h('p', { class: 'tp-attrib' }, 'Powered by OpenAI'),
    );
    return wrap;
  }

  /**
   * Builds the English typing guide and explanations after translation; render calls it for success state.
   * @param successState - Successful translation data displayed by the panel.
   * @returns Success stack with progress spans, source text, and explanations.
   * @example
   * successView({ status: 'success', original: 'こんにちは', english: 'Hello', kaisetsu: [] })
   */
  function successView(
    successState: Extract<PanelState, { status: 'success' }>,
  ): HTMLElement {
    const wrap = h('div', { class: 'tp-stack' });

    // 英訳（ヒーロー）＋コピーボタン
    const copyIcon = iconEl('copy');
    const copyLabel = h('span', {}, 'コピー');
    const copyBtn = h(
      'button',
      {
        class: 'tp-btn tp-copy',
        type: 'button',
        onclick: () => {
          callbacks.onCopy(successState.english);
          copyIcon.innerHTML = ICONS.check;
          copyLabel.textContent = 'コピーしました!';
          toast('コピーしました!');
          setTimeout(() => {
            copyIcon.innerHTML = ICONS.copy;
            copyLabel.textContent = 'コピー';
          }, 1600);
        },
      },
      copyIcon,
      copyLabel,
    );
    let englishText: HTMLElement;
    // A non-empty translation becomes two adjacent spans so each input updates only the guide text.
    if (successState.english.trim()) {
      renderedEnglish = successState.english;
      completedEnglishElement = h('span', { class: 'tp-english-completed' });
      remainingEnglishElement = h(
        'span',
        { class: 'tp-english-remaining' },
        successState.english,
      );
      englishText = h(
        'div',
        { class: 'tp-text' },
        completedEnglishElement,
        remainingEnglishElement,
      );
    } else {
      // Keep the existing empty-result recovery message instead of starting a practice session with no target.
      englishText = h('div', { class: 'tp-text tp-muted' }, '（英訳が空でした。再試行してください）');
    }
    wrap.append(
      h(
        'section',
        { class: 'tp-card tp-english' },
        h(
          'div',
          { class: 'tp-section-head' },
          h('span', { class: 'tp-badge tp-badge-en' }, 'English'),
          copyBtn,
        ),
        englishText,
      ),
      originalCard(successState.original),
    );

    // 解説（複数可）
    for (const explanation of successState.kaisetsu) {
      wrap.append(
        h(
          'section',
          { class: 'tp-card tp-kaisetsu' },
          h('div', { class: 'tp-section-head' }, h('span', { class: 'tp-badge' }, '解説')),
          h('div', { class: 'tp-text' }, explanation),
        ),
      );
    }
    return wrap;
  }

  /**
   * Builds recovery actions for a failed translation; render calls it for error state.
   * @param errorState - Error kind and user-facing message from the background translator.
   * @returns Error card with settings or retry actions when applicable.
   * @example
   * errorView({ status: 'error', kind: 'NETWORK', message: 'Offline' })
   */
  function errorView(errorState: Extract<PanelState, { status: 'error' }>): HTMLElement {
    const actions = h('div', { class: 'tp-error-actions' });
    if (SETTINGS_KINDS.includes(errorState.kind)) {
      actions.append(
        h(
          'button',
          {
            class: 'tp-btn tp-btn-primary',
            type: 'button',
            onclick: () => callbacks.onOpenSettings(),
          },
          '設定を開く',
        ),
      );
    }
    if (RETRY_KINDS.includes(errorState.kind)) {
      actions.append(
        h(
          'button',
          { class: 'tp-btn', type: 'button', onclick: () => callbacks.onRetry() },
          '再試行',
        ),
      );
    }
    return h(
      'div',
      { class: 'tp-error' },
      iconEl('alert', 'tp-icon tp-error-icon'),
      h(
        'div',
        {},
        h('p', { class: 'tp-error-title' }, '英訳できませんでした'),
        h('p', { class: 'tp-error-msg' }, errorState.message),
      ),
      actions,
    );
  }

  /**
   * Replaces panel content for a translation state; content-script translation flows call it on every state change.
   * @param state - Loading, success, or error state to display.
   * @returns Nothing.
   * @example
   * render({ status: 'loading', original: 'こんにちは' })
   */
  function render(state: PanelState): void {
    // A new translation owns the canvas and guide, so discard every visual reference from the previous one.
    launchConfetti.reset();
    renderedEnglish = '';
    completedEnglishElement = null;
    remainingEnglishElement = null;
    body.replaceChildren();
    if (state.status === 'loading') body.append(loadingView(state.original));
    else if (state.status === 'success') body.append(successView(state));
    else body.append(errorView(state));
  }

  /**
   * Shows a short status message for copy and save actions; panel callbacks call it after user-visible outcomes.
   * @param message - Text announced and displayed in the panel toast.
   * @returns Nothing.
   * @example
   * toast('コピーしました!')
   */
  function toast(message: string): void {
    toastEl.textContent = message;
    toastEl.setAttribute('data-show', 'true');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.setAttribute('data-show', 'false'), 1800);
  }

  /**
   * Moves the correct prefix into the muted span after each relevant input; the typing controller supplies the count.
   * @param matchedCharacterCount - Number of correct leading English characters.
   * @returns Nothing when no English guide is rendered, otherwise updates the two guide spans.
   * @example
   * updateTypingProgress(3) // => "Hel" is muted and "lo" remains for "Hello"
   */
  function updateTypingProgress(matchedCharacterCount: number): void {
    // Loading, error, and empty translations do not have progress spans to update.
    if (!completedEnglishElement || !remainingEnglishElement) return;
    const boundedCharacterCount = Math.min(
      Math.max(matchedCharacterCount, 0),
      renderedEnglish.length,
    );
    completedEnglishElement.textContent = renderedEnglish.slice(0, boundedCharacterCount);
    remainingEnglishElement.textContent = renderedEnglish.slice(boundedCharacterCount);
  }

  /**
   * Launches the full-screen reward when one guide is completed; the typing controller prevents duplicate calls.
   * @returns Nothing; canvas-confetti owns the asynchronous animation lifecycle.
   * @example
   * celebrate() // => fires one branded completion burst
   */
  function celebrate(): void {
    void launchConfetti({
      particleCount: TYPING_CONFETTI_PARTICLE_COUNT,
      spread: TYPING_CONFETTI_SPREAD_DEGREES,
      startVelocity: TYPING_CONFETTI_START_VELOCITY,
      origin: { y: TYPING_CONFETTI_ORIGIN_Y_RATIO },
    });
  }

  /**
   * Hides the panel and clears any reward particles when the close button calls the handle.
   * @returns Nothing.
   * @example
   * hide() // => closes the panel and stops active confetti
   */
  function hide(): void {
    launchConfetti.reset();
    panel.setAttribute('data-state', 'closed');
  }

  return {
    show: () => panel.setAttribute('data-state', 'open'),
    hide,
    render,
    toast,
    updateTypingProgress,
    celebrate,
  };
}
