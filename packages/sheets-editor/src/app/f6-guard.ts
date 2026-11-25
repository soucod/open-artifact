export function yieldF6ToToasts(target: Window, shouldYield: () => boolean) {
  target.addEventListener('keydown', (event) => {
    if (event.key === 'F6' && shouldYield()) event.stopImmediatePropagation();
  });
}
