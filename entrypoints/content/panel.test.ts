// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from 'vitest';

const confettiMocks = vi.hoisted(() => {
  const reset = vi.fn();
  const burst = Object.assign(vi.fn(), { reset });
  return {
    burst,
    create: vi.fn(() => burst),
    reset,
  };
});

vi.mock('canvas-confetti', () => ({
  default: { create: confettiMocks.create },
}));

import { mountPanel } from './panel';

describe('translation panel typing feedback', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  test('grays the correctly typed English prefix while keeping the remaining guide visible', () => {
    // Arrange
    const container = document.createElement('div');
    document.body.append(container);
    const panel = mountPanel(container, {
      onClose: vi.fn(),
      onCopy: vi.fn(),
      onRetry: vi.fn(),
      onOpenSettings: vi.fn(),
    });
    panel.render({ status: 'success', original: 'こんにちは', english: 'Hello', kaisetsu: [] });

    // Act
    panel.updateTypingProgress(3);

    // Assert
    const completedText = container.querySelector('.tp-english-completed');
    const remainingText = container.querySelector('.tp-english-remaining');
    expect(completedText?.textContent).toBe('Hel');
    expect(remainingText?.textContent).toBe('lo');
  });

  test('fires an accessible full-screen confetti burst from the persistent panel canvas', () => {
    // Arrange
    const container = document.createElement('div');
    document.body.append(container);
    const panel = mountPanel(container, {
      onClose: vi.fn(),
      onCopy: vi.fn(),
      onRetry: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    // Act
    panel.celebrate();

    // Assert
    expect(confettiMocks.create).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), {
      resize: true,
      useWorker: false,
      disableForReducedMotion: true,
    });
    expect(container.querySelector('.tp-confetti')?.getAttribute('aria-hidden')).toBe('true');
    expect(confettiMocks.burst).toHaveBeenCalledWith({
      particleCount: 120,
      spread: 100,
      startVelocity: 45,
      origin: { y: 0.65 },
    });
  });
});
