// 右端の常駐パネル（素の DOM）。状態(loading/success/error)に応じて本文を再描画する。
// × を押すまで閉じない（Esc・外側クリックでは閉じない＝仕様）。コピーボタンとトーストを内蔵。

import { ICONS, iconEl } from './icons';
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
 * パネルを container（Shadow root 内）にマウントし、操作ハンドルを返す。
 * @param container Shadow root 内のマウント先
 * @param cb 閉じる/コピー/再試行/設定オープンのコールバック
 */
export function mountPanel(container: HTMLElement, cb: PanelCallbacks): PanelHandle {
  const body = h('div', { class: 'tp-body' });
  const header = h(
    'header',
    { class: 'tp-header' },
    h('h2', { class: 'tp-title' }, '英訳と解説'),
    h(
      'button',
      { class: 'tp-close', type: 'button', 'aria-label': '閉じる', onclick: () => cb.onClose() },
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

  function originalCard(original: string): HTMLElement {
    // 翻訳元の日本語。入力欄からは消えるためここが唯一の控え（安全網）。常時表示。
    return h(
      'section',
      { class: 'tp-card tp-original' },
      h('div', { class: 'tp-section-head' }, h('span', { class: 'tp-badge' }, 'あなたの日本語')),
      h('div', { class: 'tp-text' }, original),
    );
  }

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

  function successView(s: Extract<PanelState, { status: 'success' }>): HTMLElement {
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
          cb.onCopy(s.english);
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
    const englishText = s.english.trim()
      ? h('div', { class: 'tp-text' }, s.english)
      : h('div', { class: 'tp-text tp-muted' }, '（英訳が空でした。再試行してください）');
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
      originalCard(s.original),
    );

    // 解説（複数可）
    for (const k of s.kaisetsu) {
      wrap.append(
        h(
          'section',
          { class: 'tp-card tp-kaisetsu' },
          h('div', { class: 'tp-section-head' }, h('span', { class: 'tp-badge' }, '解説')),
          h('div', { class: 'tp-text' }, k),
        ),
      );
    }
    return wrap;
  }

  function errorView(s: Extract<PanelState, { status: 'error' }>): HTMLElement {
    const actions = h('div', { class: 'tp-error-actions' });
    if (SETTINGS_KINDS.includes(s.kind)) {
      actions.append(
        h(
          'button',
          { class: 'tp-btn tp-btn-primary', type: 'button', onclick: () => cb.onOpenSettings() },
          '設定を開く',
        ),
      );
    }
    if (RETRY_KINDS.includes(s.kind)) {
      actions.append(
        h('button', { class: 'tp-btn', type: 'button', onclick: () => cb.onRetry() }, '再試行'),
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
        h('p', { class: 'tp-error-msg' }, s.message),
      ),
      actions,
    );
  }

  function render(state: PanelState): void {
    body.replaceChildren();
    if (state.status === 'loading') body.append(loadingView(state.original));
    else if (state.status === 'success') body.append(successView(state));
    else body.append(errorView(state));
  }

  function toast(message: string): void {
    toastEl.textContent = message;
    toastEl.setAttribute('data-show', 'true');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.setAttribute('data-show', 'false'), 1800);
  }

  return {
    show: () => panel.setAttribute('data-state', 'open'),
    hide: () => panel.setAttribute('data-state', 'closed'),
    render,
    toast,
  };
}
