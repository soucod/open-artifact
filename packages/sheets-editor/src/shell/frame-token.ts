export function reloadOpaqueSandboxedFrames(root: ParentNode): void {
  for (let frame of root.querySelectorAll<HTMLIFrameElement>('iframe[sandbox]:not([sandbox~="allow-same-origin"])')) {
    let { parentNode: parent, nextSibling } = frame;
    frame.remove();
    frame.srcdoc = '';
    parent?.insertBefore(frame, nextSibling);
  }
}
export function stripFrameTimestampParams(win: Window = window): boolean {
  try {
    if (!windowsWatchingFrameParams.has(win)) {
      win.addEventListener('popstate', () => {
        if (!stripFrameTimestampParams(win)) reloadOpaqueSandboxedFrames(win.document);
      });
      windowsWatchingFrameParams.add(win);
    }
    let { search, pathname, hash } = win.location;
    if (hasFrameTimestampParam(search)) {
      let kept = search
        .slice(1)
        .split('&')
        .filter((param) => !frameTimestampParamPattern.test(param))
        .join('&');
      win.history.replaceState(win.history.state, '', pathname + (kept === '' ? '' : '?' + kept) + hash);
    }
    return !hasFrameTimestampParam(win.location.search) && !hasFrameTimestampParam(new URL(win.document.baseURI).search);
  } catch {
    return false;
  }
}
export const frameTimestampParamPattern = /^__frame_t(?:=|$)/;
export const hasFrameTimestampParam = (search: string): boolean =>
  search
    .slice(1)
    .split('&')
    .some((param) => frameTimestampParamPattern.test(param));
export const windowsWatchingFrameParams = new WeakSet<Window>();
