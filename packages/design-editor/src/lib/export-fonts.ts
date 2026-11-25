import { decodeEntities } from '@open-artifact/dc';
import { blockUnicodeRange, cssUrls, fontFaceBlocks, parseUnicodeRange, rangeCovers } from '@open-artifact/export-kit';
import { dataUrl } from './export-html.ts';

interface Notices { texts: [string, string][]; families: Record<string, [number, string]> }

/** Copyright and license texts from google/fonts. Loaded only for an export that embeds fonts. */
async function fontNotices(): Promise<Notices> {
  const { default: archive } = await import('../data/google-fonts-notices.json', { with: { type: 'json' } });
  const bytes = Uint8Array.from(atob(archive.gzip), c => c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
}

/** Font downloads and notices shared across the artboards in one export. */
export class ExportFonts {
  private sheets = new Map<string, Promise<string>>();
  private binaries = new Map<string, Promise<string>>();
  private families = new Set<string>();
  readonly missing = new Set<string>();
  /** Hosts that sent no response in time. Later fonts from them fail at once instead of waiting again. */
  private silentHosts = new Set<string>();

  private readonly request: typeof fetch;
  private readonly timeout: number;

  constructor(request: typeof fetch = fetch, timeout = 12000) {
    this.request = request;
    this.timeout = timeout;
  }

  /** The response, whose body must arrive within what is left of the same timeout. */
  private async load(url: string): Promise<Response> {
    const host = new URL(url).origin;
    if (this.silentHosts.has(host)) throw new Error('Font host did not respond');
    const signal = AbortSignal.timeout(this.timeout);
    let response: Response;
    try {
      response = await this.request(url, { credentials: 'omit', redirect: 'error', signal });
    } catch (error) {
      if (signal.aborted) this.silentHosts.add(host);
      throw error;
    }
    if (!response.ok) throw new Error('Font unavailable');
    return response;
  }

  private async css(url: string, points: Set<number>): Promise<string> {
    let sheet = this.sheets.get(url);
    if (!sheet) {
      sheet = this.load(url).then(r => r.text());
      this.sheets.set(url, sheet);
    }
    const blocks = fontFaceBlocks(await sheet).filter(block => rangeCovers(parseUnicodeRange(blockUnicodeRange(block)), points));
    if (!blocks.length) throw new Error('No matching font faces');
    const rules = await Promise.all(blocks.map(async block => {
      let rule = block;
      for (const { url, match } of cssUrls(block)) {
        if (!url.startsWith('https://fonts.gstatic.com/')) throw new Error('Unknown font host');
        let data = this.binaries.get(url);
        if (!data) {
          data = this.load(url).then(async response => dataUrl(new URL(url).pathname, new Uint8Array(await response.arrayBuffer())));
          this.binaries.set(url, data);
        }
        const embedded = await data;
        rule = rule.replace(match, () => 'url("' + embedded + '")');
      }
      return rule;
    }));
    return rules.join('\n');
  }

  async inline(source: string, points: Set<number>): Promise<string> {
    const links = [...source.matchAll(/<link\b[^>]*\bhref\s*=\s*["'](https:\/\/fonts\.googleapis\.com\/css2?\?[^"']+)["'][^>]*>|@import\s+(?:url\(\s*)?["'](https:\/\/fonts\.googleapis\.com\/css2?\?[^"']+)["']\s*\)?\s*;/gi)];
    for (const [tag, link, imported] of links) {
      const url = decodeEntities(link ?? imported!);
      const families = new URL(url).searchParams.getAll('family').flatMap(value => value.split('|').map(f => f.split(':')[0]!));
      try {
        const css = await this.css(url, points);
        source = source.replace(tag, () => link ? '<style>' + css + '</style>' : css);
        for (const family of families) this.families.add(family);
      } catch {
        for (const family of families) this.missing.add(family);
      }
    }
    return source;
  }

  async notice(): Promise<string> {
    if (!this.families.size) return '';
    const catalog = await fontNotices();
    const lines = ['Embedded Google Fonts. Check their licenses before redistributing.'];
    const licenses = new Set<string>();
    for (const family of this.families) {
      lines.push(family);
      const item = Object.hasOwn(catalog.families, family) && catalog.families[family];
      if (item) {
        lines.push(item[1], catalog.texts[item[0]]![0]);
        licenses.add(catalog.texts[item[0]]![1]);
      } else lines.push('License and attribution: https://fonts.google.com/specimen/' + encodeURIComponent(family) + '/license');
    }
    return '<!--\n' + [...lines, ...licenses].join('\n\n').replace(/--/g, '—').replace(/</g, '&lt;') + '\n-->\n';
  }
}
