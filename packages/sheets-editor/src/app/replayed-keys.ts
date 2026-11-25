export function stopReplayedKeydowns(target: Window, isTargetOurs: (target: EventTarget | null) => boolean) {
  // A keydown replayed into the page is marked with `isReplay: true`.
  let onKeydown = (event: KeyboardEvent & { isReplay?: boolean }) => {
    if (Reflect.get(event, 'isReplay') === true && isTargetOurs(event.target)) event.stopPropagation();
  };
  target.addEventListener('keydown', onKeydown, true);
}
