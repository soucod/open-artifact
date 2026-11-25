export function watchTabVisibility(onVisibility: (isHidden: boolean) => void) {
  let tell = () => onVisibility(document.hidden);
  tell();
  document.addEventListener('visibilitychange', tell);
  window.addEventListener('focus', tell);
  window.addEventListener('online', tell);
  return () => {
    document.removeEventListener('visibilitychange', tell);
    window.removeEventListener('focus', tell);
    window.removeEventListener('online', tell);
  };
}
