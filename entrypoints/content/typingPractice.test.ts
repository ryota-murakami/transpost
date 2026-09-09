// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createTypingPractice } from './typingPractice';

describe('typing practice', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test('keeps the English guide gray only through the last correct character after a typo', () => {
    // Arrange
    const composer = document.createElement('div');
    composer.contentEditable = 'true';
    document.body.append(composer);
    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const typingPractice = createTypingPractice({ onProgress, onComplete });
    typingPractice.start('Hello', composer);
    composer.addEventListener('input', typingPractice.handleInput);

    // Act
    composer.innerText = 'Hex';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));

    // Assert
    expect(onProgress).toHaveBeenLastCalledWith(2);
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('returns deleted characters to the untyped guide while the user corrects the draft', () => {
    // Arrange
    const composer = document.createElement('div');
    composer.contentEditable = 'true';
    document.body.append(composer);
    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const typingPractice = createTypingPractice({ onProgress, onComplete });
    typingPractice.start('Hello', composer);
    composer.addEventListener('input', typingPractice.handleInput);

    // Act
    composer.innerText = 'Hell';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
    composer.innerText = 'He';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));

    // Assert
    expect(onProgress.mock.calls).toEqual([[4], [2]]);
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('stops hidden guide feedback after the panel closes its typing session', () => {
    // Arrange
    const composer = document.createElement('div');
    composer.contentEditable = 'true';
    document.body.append(composer);
    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const typingPractice = createTypingPractice({ onProgress, onComplete });
    typingPractice.start('Hello', composer);
    composer.addEventListener('input', typingPractice.handleInput);

    // Act
    typingPractice.reset();
    composer.innerText = 'Hello';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));

    // Assert
    expect(onProgress).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('celebrates an exact translation once until the next translation starts', () => {
    // Arrange
    const composer = document.createElement('div');
    composer.contentEditable = 'true';
    document.body.append(composer);
    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const typingPractice = createTypingPractice({ onProgress, onComplete });
    typingPractice.start('Hello', composer);
    composer.addEventListener('input', typingPractice.handleInput);

    // Act
    composer.innerText = 'Hell';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
    composer.innerText = 'Hello';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
    composer.innerText = 'Hello!';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
    composer.innerText = 'Hello';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));

    // Assert
    expect(onProgress.mock.calls).toEqual([[4], [5], [5], [5]]);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Act
    typingPractice.start('Bye', composer);
    composer.innerText = 'Bye';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));

    // Assert
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  test('accepts keyboard quotes and spaces for typographic characters in the translated guide', () => {
    // Arrange
    const composer = document.createElement('div');
    composer.contentEditable = 'true';
    document.body.append(composer);
    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const typingPractice = createTypingPractice({ onProgress, onComplete });
    typingPractice.start('“You’re\u00a0ready”', composer);
    composer.addEventListener('input', typingPractice.handleInput);

    // Act
    composer.innerText = '"You\'re ready"';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));

    // Assert
    expect(onProgress).toHaveBeenLastCalledWith(14);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
