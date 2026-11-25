import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isFocusLost, watchFocusInside, type FocusContainer } from '../src/sources/focus.ts';

/** A container element: an event target that holds some children. */
function container(children: readonly object[]): FocusContainer & { fire(type: 'focusin' | 'focusout', relatedTarget: unknown): void } {
  const target = new EventTarget();
  return {
    addEventListener: (type, listener) => target.addEventListener(type, listener as unknown as EventListener),
    removeEventListener: (type, listener) => target.removeEventListener(type, listener as unknown as EventListener),
    contains: (other) => children.includes(other as object),
    fire(type, relatedTarget) {
      target.dispatchEvent(Object.assign(new Event(type), { relatedTarget }));
    },
  };
}

describe('keeping focus in the Sources panel', () => {
  const body = {};
  const fix = {};
  const elsewhere = {};

  it('counts focus as lost on the body or on nothing', () => {
    assert.equal(isFocusLost({ activeElement: body, body }), true);
    assert.equal(isFocusLost({ activeElement: null, body }), true);
    assert.equal(isFocusLost({ activeElement: fix, body }), false);
  });

  it('remembers focus that was inside, even when it then fell to nowhere', () => {
    const box = container([fix]);
    const stop = watchFocusInside(box, { activeElement: fix });
    box.fire('focusout', null);
    assert.equal(stop(), true);
  });

  it('forgets focus that moved on to another element', () => {
    const box = container([fix]);
    const stop = watchFocusInside(box, { activeElement: fix });
    box.fire('focusout', elsewhere);
    assert.equal(stop(), false);
  });

  it('follows focus coming in after it started', () => {
    const box = container([fix]);
    const stop = watchFocusInside(box, { activeElement: body });
    box.fire('focusin', null);
    box.fire('focusout', fix);
    assert.equal(stop(), true);
  });

  it('stops listening once it is told to', () => {
    const box = container([fix]);
    const stop = watchFocusInside(box, { activeElement: body });
    assert.equal(stop(), false);
    box.fire('focusin', null);
    assert.equal(stop(), false);
  });
});
