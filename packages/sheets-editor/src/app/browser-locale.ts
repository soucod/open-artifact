export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const browserLocales = (
  languages: readonly string[] = [...navigator.languages, Intl.DateTimeFormat().resolvedOptions().locale],
) =>
  languages.flatMap((tag) => {
    try {
      let { language, region } = new Intl.Locale(tag).maximize();
      return [region === undefined ? language : `${language}-${region}`];
    } catch {
      return [];
    }
  });
