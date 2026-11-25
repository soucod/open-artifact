/**
 * A Word file (.docx) as a tab, read by hand as docx.ts writes one. It reads what a doc can hold: headings
 * (by style, or by a style's outline level), paragraphs with their marks, lists by their numbering, tables with their
 * merged cells and column widths, quotes, code, rules, links, pictures, footnotes. What a doc has no place for (page
 * layout, headers and footers, comments, drawn shapes) stays out, and the notes count what a reader would miss.
 *
 * Tracked changes are read as if accepted: what was inserted stays, what was deleted goes.
 */
import { type Block, blockHref, blocksFromJson, type IdSource, imageInfo, TEXT_COLORS, walk } from '@open-artifact/docs-core';
import { readZip as readSharedZip, ZipError } from '../unzip.ts';
import { ImportRefusal, type ImportedTab, type ImportImages, type ImportNotes, type Json } from './import.ts';

// ---- the package ---------------------------------------------------------------------------------------------------

/** The most one entry may expand to, against a file that is mostly a compression trick. */
const MAX_ENTRY = 256 * 1024 * 1024;

/** The package's parts, each read on demand; the shared zip reader's refusals in a Word import's words. */
function readZip(bytes: Uint8Array): Map<string, () => Buffer> {
  let parts: Map<string, () => Buffer>;
  try {
    parts = readSharedZip(bytes, MAX_ENTRY);
  } catch (error) {
    if (error instanceof ZipError) throw new ImportRefusal('not_docx', "This file isn't a Word document: it can't be opened as one.");
    throw error;
  }
  const entries = new Map<string, () => Buffer>();
  for (const [name, read] of parts) {
    entries.set(name, () => {
      try {
        return read();
      } catch (error) {
        if (error instanceof ZipError) throw new ImportRefusal('not_docx', 'This Word file is damaged: one of its parts is missing.');
        throw error;
      }
    });
  }
  return entries;
}

// ---- XML -----------------------------------------------------------------------------------------------------------

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: (XmlNode | string)[];
}

/** Every namespace a Word file may name by another prefix, or by the strict variant's URI, as the prefix used below. */
const PREFIXES: Record<string, string> = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
  'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://purl.oclc.org/ooxml/drawingml/main': 'a',
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'wp',
  'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing': 'wp',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'urn:schemas-microsoft-com:vml': 'v',
  'http://purl.org/dc/elements/1.1/': 'dc',
};

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (text: string) =>
  text.includes('&')
    ? text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal?: string, hex?: string, name?: string) => {
        if (name) return XML_ENTITIES[name] ?? whole;
        const code = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hex!, 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      })
    : text;

/** The tree, with names under the prefixes above. A DOCTYPE is skipped, so nothing in a file can define an entity. */
function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: '', attrs: {}, children: [] };
  const stack: { node: XmlNode; spaces: Map<string, string> }[] = [{ node: root, spaces: new Map() }];
  let at = 0;
  const canonical = (qualified: string, spaces: Map<string, string>, isAttr: boolean) => {
    const colon = qualified.indexOf(':');
    const prefix = colon < 0 ? '' : qualified.slice(0, colon);
    const local = colon < 0 ? qualified : qualified.slice(colon + 1);
    if (colon < 0 && isAttr) return local;
    const known = PREFIXES[spaces.get(prefix) ?? ''];
    return known ? `${known}:${local}` : qualified;
  };
  while (at < text.length) {
    const open = text.indexOf('<', at);
    const top = stack[stack.length - 1]!;
    if (open < 0) break;
    if (open > at) top.node.children.push(decodeXml(text.slice(at, open)));
    if (text.startsWith('<!--', open)) {
      const close = text.indexOf('-->', open);
      at = close < 0 ? text.length : close + 3;
    } else if (text.startsWith('<![CDATA[', open)) {
      const close = text.indexOf(']]>', open);
      top.node.children.push(text.slice(open + 9, close < 0 ? text.length : close));
      at = close < 0 ? text.length : close + 3;
    } else if (text.startsWith('<?', open) || text.startsWith('<!', open)) {
      const close = text.indexOf('>', open);
      at = close < 0 ? text.length : close + 1;
    } else if (text.startsWith('</', open)) {
      if (stack.length > 1) stack.pop();
      const close = text.indexOf('>', open);
      at = close < 0 ? text.length : close + 1;
    } else {
      const tag = /^<([^\s/>]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(text.slice(open, open + 65536));
      if (!tag) {
        at = open + 1;
        continue;
      }
      const raw = [...tag[2]!.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1]!, decodeXml(match[2] ?? match[3] ?? '')] as const);
      const declared = raw.filter(([name]) => name === 'xmlns' || name.startsWith('xmlns:'));
      const spaces = declared.length ? new Map(top.spaces) : top.spaces;
      for (const [name, value] of declared) spaces.set(name === 'xmlns' ? '' : name.slice(6), value);
      const attrs: Record<string, string> = {};
      for (const [name, value] of raw) if (name !== 'xmlns' && !name.startsWith('xmlns:')) attrs[canonical(name, spaces, true)] = value;
      const node: XmlNode = { name: canonical(tag[1]!, spaces, false), attrs, children: [] };
      top.node.children.push(node);
      if (!tag[3]) stack.push({ node, spaces });
      at = open + tag[0].length;
    }
  }
  return root;
}

const elements = (node: XmlNode | undefined) => (node?.children ?? []).filter((child): child is XmlNode => typeof child !== 'string');
const child = (node: XmlNode | undefined, name: string) => elements(node).find(item => item.name === name);
const all = (node: XmlNode | undefined, name: string) => elements(node).filter(item => item.name === name);
function descendant(node: XmlNode, name: string): XmlNode | undefined {
  for (const item of elements(node)) {
    if (item.name === name) return item;
    const found = descendant(item, name);
    if (found) return found;
  }
  return undefined;
}
const textOf = (node: XmlNode): string => node.children.map(item => (typeof item === 'string' ? item : textOf(item))).join('');
/** The bookmarks a paragraph holds, by name. */
function bookmarksIn(node: XmlNode, out: string[] = []): string[] {
  for (const item of elements(node)) {
    if (item.name === 'w:bookmarkStart' && item.attrs['w:name']) out.push(item.attrs['w:name']);
    else bookmarksIn(item, out);
  }
  return out;
}

/** A link to a bookmark of the file, until the import knows which block holds it. Not an address anything could hold. */
const BOOKMARK = '\u0000bookmark:';

/** Where a HYPERLINK field goes: its address, or with `\l` alone a bookmark of the file. */
function fieldLink(code: string): string | undefined {
  if (!/\bHYPERLINK\b/i.test(code)) return undefined;
  const address = /HYPERLINK\s+"([^"]+)"/i.exec(code)?.[1];
  if (address) return address;
  const bookmark = /\\l\s+"([^"]+)"/i.exec(code)?.[1];
  return bookmark ? BOOKMARK + bookmark : undefined;
}
const val = (node: XmlNode | undefined) => node?.attrs['w:val'];
/** A toggle (`<w:b/>`, `<w:b w:val="0"/>`): present and not turned off. */
const isOn = (node: XmlNode | undefined) => !!node && !['0', 'false', 'off', 'none'].includes((val(node) ?? '').toLowerCase());

// ---- the document's parts -----------------------------------------------------------------------------------------

interface RunProps {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  code?: boolean;
  highlight?: string;
  /** One of the page's text colours (a file this tool wrote, or one that happens to use the same colour). */
  textColor?: string;
}

interface Style {
  id: string;
  name: string;
  type: string;
  basedOn?: string | undefined;
  outline?: number | undefined;
  numId?: string | undefined;
  ilvl?: number | undefined;
  run: RunProps;
}

interface Level {
  format: string;
  text: string;
  start: number;
}

const MONO_FONT = /^(consolas|courier|courier new|menlo|monaco|sf mono|source code|fira code|jetbrains mono|cascadia|lucida console|andale mono|ibm plex mono|roboto mono|ubuntu mono|dejavu sans mono)/i;
const HIGHLIGHTS: Record<string, string> = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#00008b', darkCyan: '#008b8b', darkGreen: '#006400', darkMagenta: '#8b008b', darkRed: '#8b0000', darkYellow: '#808000', darkGray: '#a9a9a9', lightGray: '#d3d3d3' };
/** The colours the page's cell menu offers: a cell keeps its background only when it is one of them. */
const CELL_COLOURS = new Set(['f0efec', 'fbebeb', 'f9ece7', 'f9eeda', 'e5f4e4', 'e7f1fb', 'efedff']);
/** A run's colour back to the page's text colour it was written as: only those exact colours, any other is left. */
const TEXT_COLOR_NAMES = new Map(Object.entries(TEXT_COLORS).map(([name, hex]) => [hex, name]));
const CHECK_OPEN = /[☐□❏❑○◻]|^$|^$/;
const CHECK_DONE = /[☑☒✓✔✅■]|^$|^$/;
const BULLET_TEXT = /^\s*[•◦▪▫‣●○■□·∙]\s+/;
const EMU_PER_PIXEL = 9525;
const TWIPS_PER_PIXEL = 15;

/** A run's own shading is its highlight; a style's isn't (a code style shades every run it marks). */
function runPropsOf(rPr: XmlNode | undefined, shading = true): RunProps {
  if (!rPr) return {};
  const props: RunProps = {};
  const set = (key: 'bold' | 'italic' | 'strike', node: XmlNode | undefined) => {
    if (node) props[key] = isOn(node);
  };
  set('bold', child(rPr, 'w:b'));
  set('italic', child(rPr, 'w:i'));
  set('strike', child(rPr, 'w:strike') ?? child(rPr, 'w:dstrike'));
  const underline = child(rPr, 'w:u');
  if (underline) props.underline = (val(underline) ?? 'single') !== 'none';
  const fonts = child(rPr, 'w:rFonts');
  if (fonts?.attrs['w:ascii'] && MONO_FONT.test(fonts.attrs['w:ascii'])) props.code = true;
  const mark = val(child(rPr, 'w:highlight'));
  if (mark && mark !== 'none') props.highlight = HIGHLIGHTS[mark] ?? '';
  const fill = shading ? child(rPr, 'w:shd')?.attrs['w:fill'] : undefined;
  if (!props.highlight && fill && /^[0-9a-f]{6}$/i.test(fill)) props.highlight = `#${fill.toLowerCase()}`;
  const color = TEXT_COLOR_NAMES.get((val(child(rPr, 'w:color')) ?? '').toLowerCase());
  if (color) props.textColor = color;
  return props;
}

/** One paragraph's reading, as a block stream assembles them into lists. */
interface ListPlace {
  kind: 'bullet' | 'ordered' | 'check';
  level: number;
  numId: string;
  start?: number;
  checked?: boolean;
}

interface OpenList {
  node: Json;
  items: Json[];
  place: ListPlace;
}

interface Inline {
  nodes: Json[];
  /** Blocks that stood inside the paragraph: a text box's. */
  extras: Json[];
  hasImage: boolean;
  /** Every piece of text is monospaced: a code line. */
  allCode: boolean;
}

class DocxReader {
  private zip: Map<string, () => Buffer>;
  private images: ImportImages;
  private notes: ImportNotes;
  private styles = new Map<string, Style>();
  private numbers = new Map<string, { abstract: string; overrides: Map<number, number> }>();
  private abstracts = new Map<string, Map<number, Level>>();
  private rels = new Map<string, { target: string; external: boolean }>();
  private footnotes = new Map<string, XmlNode>();
  private endnotes = new Map<string, XmlNode>();
  /** What the body cites, in the order it does, each with the marker it got. */
  private cited: { marker: number; node: XmlNode }[] = [];
  private sawTracked = false;
  private tableOfContents = 0;
  /** The bookmarks each block's JSON holds; and those met between paragraphs, for the next block that is made. */
  private bookmarks = new WeakMap<Json, string[]>();
  private loose: string[] = [];

  constructor(zip: Map<string, () => Buffer>, images: ImportImages, notes: ImportNotes) {
    this.zip = zip;
    this.images = images;
    this.notes = notes;
  }

  private part(name: string): XmlNode | undefined {
    const read = this.zip.get(name);
    return read ? parseXml(read().toString('utf8')) : undefined;
  }

  title(): string | undefined {
    const title = this.part('docProps/core.xml');
    const found = title && descendant(title, 'dc:title');
    return found ? textOf(found).trim() || undefined : undefined;
  }

  load(): void {
    for (const style of all(child(this.part('word/styles.xml'), 'w:styles'), 'w:style')) {
      const id = style.attrs['w:styleId'];
      if (!id) continue;
      const pPr = child(style, 'w:pPr');
      const numPr = child(pPr, 'w:numPr');
      const outline = val(child(pPr, 'w:outlineLvl'));
      this.styles.set(id, {
        id,
        name: (val(child(style, 'w:name')) ?? id).toLowerCase(),
        type: style.attrs['w:type'] ?? 'paragraph',
        basedOn: val(child(style, 'w:basedOn')),
        outline: outline === undefined ? undefined : Number(outline),
        numId: val(child(numPr, 'w:numId')),
        ilvl: val(child(numPr, 'w:ilvl')) === undefined ? undefined : Number(val(child(numPr, 'w:ilvl'))),
        run: runPropsOf(child(style, 'w:rPr'), false),
      });
    }
    const numbering = child(this.part('word/numbering.xml'), 'w:numbering');
    for (const abstract of all(numbering, 'w:abstractNum')) {
      const levels = new Map<number, Level>();
      for (const level of all(abstract, 'w:lvl'))
        levels.set(Number(level.attrs['w:ilvl']), { format: val(child(level, 'w:numFmt')) ?? 'decimal', text: val(child(level, 'w:lvlText')) ?? '', start: Number(val(child(level, 'w:start')) ?? 1) });
      this.abstracts.set(abstract.attrs['w:abstractNumId'] ?? '', levels);
    }
    for (const num of all(numbering, 'w:num')) {
      const overrides = new Map<number, number>();
      for (const override of all(num, 'w:lvlOverride')) {
        const start = val(child(override, 'w:startOverride'));
        if (start !== undefined) overrides.set(Number(override.attrs['w:ilvl']), Number(start));
      }
      this.numbers.set(num.attrs['w:numId'] ?? '', { abstract: val(child(num, 'w:abstractNumId')) ?? '', overrides });
    }
    for (const rel of all(child(this.part('word/_rels/document.xml.rels'), 'Relationships'), 'Relationship')) {
      const target = rel.attrs.Target ?? '';
      this.rels.set(rel.attrs.Id ?? '', { target, external: rel.attrs.TargetMode === 'External' });
    }
    const notesOf = (part: string, root: string, name: string, into: Map<string, XmlNode>) => {
      for (const note of all(child(this.part(part), root), name)) if (!note.attrs['w:type'] || note.attrs['w:type'] === 'normal') into.set(note.attrs['w:id'] ?? '', note);
    };
    notesOf('word/footnotes.xml', 'w:footnotes', 'w:footnote', this.footnotes);
    notesOf('word/endnotes.xml', 'w:endnotes', 'w:endnote', this.endnotes);
  }

  /** Walks a style and what it is based on, nearest first; a loop in a damaged file ends it. */
  private *chain(id: string | undefined): Generator<Style> {
    const seen = new Set<string>();
    for (let style = id ? this.styles.get(id) : undefined; style && !seen.has(style.id); style = style.basedOn ? this.styles.get(style.basedOn) : undefined) {
      seen.add(style.id);
      yield style;
    }
  }

  private headingOf(styleId: string | undefined, pPr: XmlNode | undefined): number {
    for (const style of this.chain(styleId)) {
      const named = /^(?:heading|标题)\s*([1-9])$/.exec(style.name) ?? /^heading([1-9])$/i.exec(style.id);
      if (named) return Math.min(Number(named[1]), 6);
      if (style.name === 'title' || style.id === 'Title' || style.name === '标题') return 1;
      if (style.outline !== undefined && style.outline < 9) return Math.min(style.outline + 1, 6);
    }
    const outline = val(child(pPr, 'w:outlineLvl'));
    return outline !== undefined && Number(outline) < 9 ? Math.min(Number(outline) + 1, 6) : 0;
  }

  private styleMatches(styleId: string | undefined, pattern: RegExp): boolean {
    for (const style of this.chain(styleId)) if (pattern.test(style.name) || pattern.test(style.id)) return true;
    return false;
  }

  private listPlaceOf(styleId: string | undefined, pPr: XmlNode | undefined): ListPlace | null {
    const numPr = child(pPr, 'w:numPr');
    let numId = val(child(numPr, 'w:numId'));
    let ilvl = val(child(numPr, 'w:ilvl')) === undefined ? undefined : Number(val(child(numPr, 'w:ilvl')));
    if (numId === undefined)
      for (const style of this.chain(styleId))
        if (style.numId !== undefined) {
          numId = style.numId;
          ilvl = ilvl ?? style.ilvl;
          break;
        }
    if (numId === undefined || numId === '0') return null;
    const level = ilvl ?? 0;
    const number = this.numbers.get(numId);
    const definition = number && this.abstracts.get(number.abstract)?.get(level);
    if (!definition || definition.format === 'none') return definition ? null : { kind: 'bullet', level, numId };
    if (definition.format === 'bullet') {
      if (CHECK_DONE.test(definition.text)) return { kind: 'check', level, numId, checked: true };
      if (CHECK_OPEN.test(definition.text)) return { kind: 'check', level, numId, checked: false };
      return { kind: 'bullet', level, numId };
    }
    return { kind: 'ordered', level, numId, start: number!.overrides.get(level) ?? definition.start };
  }

  // ---- inline ----

  private runProps(rPr: XmlNode | undefined): RunProps {
    const merged: RunProps = {};
    const styleId = val(child(rPr, 'w:rStyle'));
    const chain = [...this.chain(styleId)].reverse();
    for (const style of chain) Object.assign(merged, style.run);
    if (styleId && this.styleMatches(styleId, /code|verbatim|preformatted/i)) merged.code = true;
    return Object.assign(merged, runPropsOf(rPr));
  }

  private marksOf(props: RunProps, link: string | undefined, plain: boolean): Json[] {
    const marks: Json[] = [];
    if (props.bold && !plain) marks.push({ type: 'bold' });
    if (props.italic) marks.push({ type: 'italic' });
    if (props.strike) marks.push({ type: 'strike' });
    if (props.code) marks.push({ type: 'code' });
    if (props.underline && !link) marks.push({ type: 'underline' });
    if (props.highlight !== undefined) marks.push({ type: 'highlight', attrs: { color: props.highlight } });
    if (link) marks.push({ type: 'link', attrs: { href: link } });
    else if (props.textColor) marks.push({ type: 'textColor', attrs: { color: props.textColor } });
    return marks;
  }

  private image(node: XmlNode, out: Inline): void {
    const blip = descendant(node, 'a:blip');
    const legacy = blip ? undefined : descendant(node, 'v:imagedata');
    const rel = blip?.attrs['r:embed'] ?? legacy?.attrs['r:id'];
    const box = descendant(node, 'wp:txbxContent') ?? descendant(node, 'w:txbxContent');
    if (box) out.extras.push(...this.blocks(elements(box)));
    if (!rel) {
      if (!box) this.notes.add('drawn shape or chart, left out');
      return;
    }
    const docPr = descendant(node, 'wp:docPr');
    const alt = docPr?.attrs.descr || docPr?.attrs.title || legacy?.attrs['o:title'] || undefined;
    const target = this.rels.get(rel);
    const read = target && !target.external ? this.zip.get(target.target.startsWith('/') ? target.target.slice(1) : `word/${target.target.replace(/^\.\//, '')}`) : undefined;
    const bytes = read?.();
    const extent = descendant(node, 'wp:extent');
    const cx = Number(extent?.attrs.cx);
    const cy = Number(extent?.attrs.cy);
    const dims = cx > 0 && cy > 0 ? { w: Math.round(cx / EMU_PER_PIXEL), h: Math.round(cy / EMU_PER_PIXEL) } : undefined;
    const media = bytes && imageInfo(bytes) ? this.images.node(bytes, { alt, name: docPr?.attrs.name, dims }) : null;
    if (media) {
      out.nodes.push(media);
      out.hasImage = true;
      return;
    }
    this.notes.add(target?.external ? 'picture linked from the web, left out' : 'picture in a format the page cannot show (EMF, WMF, TIFF), left out');
    if (alt) out.nodes.push({ type: 'text', text: alt, marks: [{ type: 'italic' }] });
  }

  private note(id: string, from: Map<string, XmlNode>, props: RunProps, link: string | undefined, plain: boolean, out: Inline): void {
    const node = from.get(id);
    if (!node) return;
    const marker = this.cited.length + 1;
    this.cited.push({ marker, node });
    out.nodes.push({ type: 'text', text: `[${marker}]`, marks: this.marksOf(props, link, plain) });
    out.allCode = false;
  }

  /** A run's content into `out`. A field's code stays out, its shown result stays in; `field` is the walk's state for that. */
  private run(run: XmlNode, link: string | undefined, plain: boolean, out: Inline, field: { depth: number; showing: boolean; link?: string | undefined; code: string }): void {
    const props = this.runProps(child(run, 'w:rPr'));
    const push = (text: string) => {
      if (!text) return;
      if (!props.code && text.trim()) out.allCode = false;
      out.nodes.push({ type: 'text', text, marks: this.marksOf(props, link ?? field.link, plain) });
    };
    for (const item of elements(run)) {
      switch (item.name) {
        case 'w:fldChar': {
          const kind = item.attrs['w:fldCharType'];
          if (kind === 'begin') {
            field.depth++;
            field.showing = false;
            field.code = '';
          } else if (kind === 'separate') {
            field.showing = true;
            field.link = fieldLink(field.code) ?? field.link;
          } else if (kind === 'end') {
            field.depth = Math.max(0, field.depth - 1);
            field.showing = false;
            if (field.depth === 0) field.link = undefined;
          }
          break;
        }
        case 'w:instrText':
          field.code += textOf(item);
          break;
        default:
          if (field.depth > 0 && !field.showing) break;
          this.runItem(item, props, link ?? field.link, plain, push, out);
      }
    }
  }

  private runItem(item: XmlNode, props: RunProps, link: string | undefined, plain: boolean, push: (text: string) => void, out: Inline): void {
    switch (item.name) {
      case 'w:t':
        push(textOf(item));
        break;
      case 'w:tab':
      case 'w:ptab':
        push('\t');
        break;
      case 'w:br':
        // A page break means nothing in a doc; a column break neither.
        if (!item.attrs['w:type'] || item.attrs['w:type'] === 'textWrapping') out.nodes.push({ type: 'hardBreak' });
        break;
      case 'w:cr':
        out.nodes.push({ type: 'hardBreak' });
        break;
      case 'w:noBreakHyphen':
        push('‑');
        break;
      case 'w:sym': {
        const code = Number.parseInt(item.attrs['w:char'] ?? '', 16);
        if (code) push(String.fromCodePoint(code >= 0xf000 ? code - 0xf000 : code));
        break;
      }
      case 'w:drawing':
      case 'w:pict':
      case 'w:object':
        this.image(item, out);
        break;
      case 'mc:AlternateContent': {
        // The first choice is the drawing; the fallback draws it again the old way.
        const choice = child(item, 'mc:Choice') ?? child(item, 'mc:Fallback');
        for (const inner of elements(choice)) this.runItem(inner, props, link, plain, push, out);
        break;
      }
      case 'w:footnoteReference':
        this.note(item.attrs['w:id'] ?? '', this.footnotes, props, link, plain, out);
        break;
      case 'w:endnoteReference':
        this.note(item.attrs['w:id'] ?? '', this.endnotes, props, link, plain, out);
        break;
      case 'w:commentReference':
        this.notes.add('Word comment, left out');
        break;
      default:
        break;
    }
  }

  private inlineOf(nodes: XmlNode[], link: string | undefined, plain: boolean, out: Inline, field: { depth: number; showing: boolean; link?: string | undefined; code: string }): void {
    for (const node of nodes) {
      switch (node.name) {
        case 'w:r':
          this.run(node, link, plain, out, field);
          break;
        case 'w:hyperlink': {
          const rel = node.attrs['r:id'] ? this.rels.get(node.attrs['r:id']) : undefined;
          // An anchor points inside the Word file, at a bookmark: a link inside the doc, once the import knows its block.
          const anchor = node.attrs['w:anchor'];
          this.inlineOf(elements(node), rel?.external ? rel.target : anchor ? BOOKMARK + anchor : link, plain, out, field);
          break;
        }
        case 'w:fldSimple': {
          const href = fieldLink(node.attrs['w:instr'] ?? '');
          this.inlineOf(elements(node), href ?? link, plain, out, field);
          break;
        }
        case 'w:ins':
        case 'w:moveTo':
          this.sawTracked = true;
          this.inlineOf(elements(node), link, plain, out, field);
          break;
        case 'w:del':
        case 'w:moveFrom':
          this.sawTracked = true;
          break;
        case 'w:smartTag':
        case 'w:sdt':
        case 'w:sdtContent':
        case 'w:customXml':
          this.inlineOf(elements(node), link, plain, out, field);
          break;
        case 'mc:AlternateContent':
          this.inlineOf(elements(child(node, 'mc:Choice') ?? child(node, 'mc:Fallback')), link, plain, out, field);
          break;
        default:
          break;
      }
    }
  }

  // ---- blocks ----

  private paragraphInline(paragraph: XmlNode, plain: boolean): Inline {
    const out: Inline = { nodes: [], extras: [], hasImage: false, allCode: true };
    this.inlineOf(elements(paragraph), undefined, plain, out, { depth: 0, showing: false, code: '' });
    return out;
  }

  /** Blocks in the order they stand; lists and code lines are gathered across the paragraphs that make them. */
  blocks(nodes: XmlNode[]): Json[] {
    const out: Json[] = [];
    let open: OpenList[] = [];
    let code: { node: Json; lines: string[] } | null = null;
    let quote: Json[] | null = null;
    const closeList = () => {
      open = [];
    };
    const closeCode = () => {
      code = null;
    };
    const closeQuote = () => {
      quote = null;
    };
    const stream = () => quote ?? out;

    const addItem = (place: ListPlace, paragraph: Json, extras: Json[]) => {
      // Back up to this level; go down by one list at a time however many levels the file skips.
      while (open.length && open[open.length - 1]!.place.level > place.level) open.pop();
      let top = open[open.length - 1];
      const same = top && top.place.level === place.level && top.place.kind === place.kind && (place.kind !== 'ordered' || top.place.numId === place.numId);
      if (top && top.place.level === place.level && !same) {
        open.pop();
        top = open[open.length - 1];
      }
      if (!same) {
        const attrs: Json = { kind: place.kind };
        if (place.kind === 'ordered' && place.start !== undefined && place.start !== 1) attrs.start = place.start;
        const node: Json = { type: 'list', attrs, content: [] };
        const parentItems = top?.items;
        if (parentItems?.length) ((parentItems[parentItems.length - 1] as Json).content as Json[]).push(node);
        else stream().push(node);
        open.push({ node, items: node.content as Json[], place });
        top = open[open.length - 1];
      }
      top!.items.push({ type: 'listItem', ...(place.kind === 'check' ? { attrs: { checked: !!place.checked } } : {}), content: [paragraph, ...extras] });
    };

    /** `node` holds the bookmarks met since the last block, and `own`. */
    const mark = (node: Json, own: string[] = []) => {
      const names = [...this.loose.splice(0), ...own];
      if (names.length) this.bookmarks.set(node, [...(this.bookmarks.get(node) ?? []), ...names]);
    };

    for (const node of nodes) {
      if (node.name === 'w:bookmarkStart') {
        if (node.attrs['w:name']) this.loose.push(node.attrs['w:name']);
        continue;
      }
      if (node.name === 'w:sdt') {
        const gallery = val(descendant(child(node, 'w:sdtPr') ?? { name: '', attrs: {}, children: [] }, 'w:docPartGallery'));
        if (gallery && /table of contents/i.test(gallery)) {
          this.tableOfContents++;
          continue;
        }
        closeList();
        closeCode();
        closeQuote();
        out.push(...this.blocks(elements(child(node, 'w:sdtContent'))));
        continue;
      }
      if (node.name === 'mc:AlternateContent') {
        out.push(...this.blocks(elements(child(node, 'mc:Choice') ?? child(node, 'mc:Fallback'))));
        continue;
      }
      if (node.name === 'w:ins' || node.name === 'w:moveTo') {
        this.sawTracked = true;
        out.push(...this.blocks(elements(node)));
        continue;
      }
      if (node.name === 'w:tbl') {
        closeList();
        closeCode();
        closeQuote();
        out.push(this.table(node));
        continue;
      }
      if (node.name !== 'w:p') continue;

      const pPr = child(node, 'w:pPr');
      const styleId = val(child(pPr, 'w:pStyle'));
      // A paragraph left out leaves its bookmarks to the next block.
      const own = bookmarksIn(node);
      if (this.styleMatches(styleId, /^(toc ?\d|toc heading|tocheading|table of figures)/i)) {
        this.tableOfContents++;
        this.loose.push(...own);
        continue;
      }
      const heading = this.headingOf(styleId, pPr);
      const inline = this.paragraphInline(node, heading > 0);
      const texty = inline.nodes.some(item => item.type !== 'text' || String(item.text).trim() !== '');
      const place = heading ? null : this.listPlaceOf(styleId, pPr);

      // An empty paragraph is how Word makes space, except a bordered one, which is how it draws a rule.
      if (!texty && !inline.extras.length) {
        if (child(child(pPr, 'w:pBdr'), 'w:bottom') || child(child(pPr, 'w:pBdr'), 'w:top')) {
          closeList();
          closeCode();
          closeQuote();
          const rule: Json = { type: 'horizontalRule' };
          mark(rule, own);
          out.push(rule);
        } else {
          closeCode();
          this.loose.push(...own);
        }
        continue;
      }

      const isCode = !heading && !place && !inline.hasImage && (this.styleMatches(styleId, /^(code|code block|source code|html preformatted|preformatted|verbatim|sourcecode)/i) || inline.allCode);
      if (isCode) {
        closeList();
        closeQuote();
        const text = inline.nodes.map(item => (item.type === 'hardBreak' ? '\n' : String(item.text ?? ''))).join('');
        if (code) {
          (code as { lines: string[] }).lines.push(text);
          ((code as { node: Json }).node.content as Json[])[0] = { type: 'text', text: (code as { lines: string[] }).lines.join('\n') };
          mark((code as { node: Json }).node, own);
        } else {
          const made = { node: { type: 'codeBlock', content: [{ type: 'text', text }] } as Json, lines: [text] };
          code = made;
          mark(made.node, own);
          out.push(made.node);
        }
        continue;
      }
      closeCode();

      const isQuote = !heading && !place && this.styleMatches(styleId, /quote|引用|block ?text/i);
      if (isQuote && !quote) {
        const node: Json = { type: 'blockquote', content: [] };
        closeList();
        quote = node.content as Json[];
        out.push(node);
      } else if (!isQuote) closeQuote();

      const paragraph: Json = { type: 'paragraph', ...(heading ? { attrs: { heading } } : {}), content: inline.nodes };
      mark(paragraph, own);
      if (place) {
        addItem(place, paragraph, inline.extras);
        continue;
      }
      // A bullet typed by hand; or more of the item above, which Word marks by its style and indent alone.
      const firstText = inline.nodes[0]?.type === 'text' ? String(inline.nodes[0].text) : '';
      if (!heading && BULLET_TEXT.test(firstText)) {
        (inline.nodes[0] as Json).text = firstText.replace(BULLET_TEXT, '');
        addItem({ kind: 'bullet', level: 0, numId: '' }, paragraph, inline.extras);
        continue;
      }
      if (!heading && open.length && this.styleMatches(styleId, /list ?paragraph|list ?continue/i)) {
        const items = open[open.length - 1]!.items;
        (((items[items.length - 1] as Json).content as Json[])).push(paragraph, ...inline.extras);
        continue;
      }
      closeList();
      stream().push(paragraph, ...inline.extras);
    }
    return out;
  }

  /** What a cell can hold: paragraphs and lists. Anything else gives up its words, not its place. */
  private cellContent(blocks: Json[]): Json[] {
    const out: Json[] = [];
    for (const block of blocks) {
      if (block.type === 'paragraph' || block.type === 'list') out.push(block);
      else if (block.type === 'codeBlock') out.push(this.same(block, { type: 'paragraph', content: ((block.content as Json[]) ?? []).map(item => ({ ...item, marks: [{ type: 'code' }] })) }));
      else if (block.type === 'blockquote') out.push(...this.cellContent((block.content as Json[]) ?? []));
      else if (block.type === 'table') {
        this.notes.add('table inside a table, kept as lines of text');
        for (const row of (block.content as Json[]) ?? []) {
          const cells = ((row.content as Json[]) ?? []).map(cell => plainWords(cell));
          out.push({ type: 'paragraph', content: [{ type: 'text', text: cells.join(' | ') }] });
        }
      }
    }
    return out.length ? out : [{ type: 'paragraph' }];
  }

  private table(table: XmlNode): Json {
    const widths = all(child(table, 'w:tblGrid'), 'w:gridCol').map(col => Number(col.attrs['w:w']) / TWIPS_PER_PIXEL);
    const usable = widths.length > 0 && widths.every(width => Number.isFinite(width) && width > 0);
    const rows = all(table, 'w:tr');
    /** Cells by grid column: a restart's rowspan is counted from the continuations under it. */
    const grid: (XmlNode | 'continue' | undefined)[][] = rows.map(row => {
      const line: (XmlNode | 'continue' | undefined)[] = [];
      for (const cell of all(row, 'w:tc')) {
        const tcPr = child(cell, 'w:tcPr');
        const span = Number(val(child(tcPr, 'w:gridSpan')) ?? 1) || 1;
        const merge = child(tcPr, 'w:vMerge');
        line.push(merge && (val(merge) ?? 'continue') === 'continue' ? 'continue' : cell);
        for (let extra = 1; extra < span; extra++) line.push(undefined);
      }
      return line;
    });
    const content = rows.map((row, rowIndex) => {
      const header = !!child(child(row, 'w:trPr'), 'w:tblHeader') || (rowIndex === 0 && !rows.some(item => child(child(item, 'w:trPr'), 'w:tblHeader')) && this.allBold(row));
      const cells: Json[] = [];
      let column = 0;
      for (const cell of all(row, 'w:tc')) {
        const tcPr = child(cell, 'w:tcPr');
        const span = Number(val(child(tcPr, 'w:gridSpan')) ?? 1) || 1;
        const at = column;
        column += span;
        if (grid[rowIndex]![at] === 'continue') continue;
        let rowspan = 1;
        while (grid[rowIndex + rowspan]?.[at] === 'continue') rowspan++;
        const attrs: Json = {};
        if (header) attrs.header = true;
        if (span > 1) attrs.colspan = span;
        if (rowspan > 1) attrs.rowspan = rowspan;
        const fill = child(tcPr, 'w:shd')?.attrs['w:fill']?.toLowerCase();
        if (fill && CELL_COLOURS.has(fill)) attrs.background = `#${fill}`;
        const align = val(child(child(child(cell, 'w:p'), 'w:pPr'), 'w:jc'));
        if (align === 'center' || align === 'right') attrs.align = align;
        if (usable && widths.length >= at + span) attrs.colwidth = widths.slice(at, at + span).map(width => Math.round(width));
        const blocks = this.cellContent(this.blocks(elements(cell).filter(item => item.name !== 'w:tcPr')));
        cells.push({ type: 'cell', attrs, content: header ? blocks.map(block => this.same(block, unbold(block))) : blocks });
      }
      return { type: 'tableRow', content: cells.length ? cells : [{ type: 'cell', content: [{ type: 'paragraph' }] }] };
    });
    return { type: 'table', content };
  }

  /** A first row all in bold reads as a header, where the file doesn't say. */
  private allBold(row: XmlNode): boolean {
    const runs: XmlNode[] = [];
    for (const cell of all(row, 'w:tc')) for (const paragraph of all(cell, 'w:p')) runs.push(...all(paragraph, 'w:r'));
    const worded = runs.filter(run => child(run, 'w:t') && textOf(child(run, 'w:t')!).trim());
    return worded.length > 0 && worded.every(run => this.runProps(child(run, 'w:rPr')).bold);
  }

  /** `to` made over from `from`: it holds `from`'s bookmarks. */
  private same(from: Json, to: Json): Json {
    const names = this.bookmarks.get(from);
    if (names && to !== from) this.bookmarks.set(to, names);
    return to;
  }

  /** What the body cited, under a rule at the end. */
  noteBlocks(): Json[] {
    const out: Json[] = [];
    // Notes can cite notes: the list grows as it is read.
    for (let index = 0; index < this.cited.length; index++) {
      const { marker, node } = this.cited[index]!;
      const blocks = this.blocks(elements(node));
      const first = blocks[0];
      if (first?.type === 'paragraph') first.content = [{ type: 'text', text: `[${marker}] ` }, ...((first.content as Json[]) ?? [])];
      else blocks.unshift({ type: 'paragraph', content: [{ type: 'text', text: `[${marker}]` }] });
      out.push(...blocks);
    }
    return out.length ? [{ type: 'horizontalRule' }, ...out] : [];
  }

  /**
   * The blocks, each link to a bookmark of the file pointed at the block that holds it, as the page's link box writes a
   * link inside the doc (`#<block id>~<slug>`). One to a bookmark the file doesn't hold keeps its words.
   */
  make(content: Json[], ids: IdSource): Block[] {
    const held = new Map<string, Block>();
    const blocks = blocksFromJson(content, ids, (node, block) => {
      for (const name of this.bookmarks.get(node) ?? []) if (!held.has(name)) held.set(name, block);
    });
    for (const { block } of walk(blocks)) {
      for (const item of block.inline ?? []) {
        const link = item.marks?.link;
        if (!link?.startsWith(BOOKMARK)) continue;
        const target = held.get(link.slice(BOOKMARK.length));
        if (target) item.marks!.link = blockHref(target);
        else {
          delete item.marks!.link;
          if (!Object.keys(item.marks!).length) delete item.marks;
        }
      }
    }
    return blocks;
  }

  finish(): void {
    if (this.tableOfContents) this.notes.add('table of contents left out: the headings make their own', 1);
    if (this.sawTracked) this.notes.add('document with tracked changes, read as if accepted', 1);
  }
}

function plainWords(node: Json): string {
  if (typeof node.text === 'string') return node.text;
  return ((node.content as Json[]) ?? []).map(plainWords).join(' ').trim();
}

/** A header cell is bold by being one. */
function unbold(block: Json): Json {
  if (block.type !== 'paragraph') return block;
  return { ...block, content: ((block.content as Json[]) ?? []).map(item => (Array.isArray(item.marks) ? { ...item, marks: (item.marks as Json[]).filter(mark => mark.type !== 'bold') } : item)) };
}

export function readDocx(bytes: Uint8Array, images: ImportImages, notes: ImportNotes): { title?: string | undefined; tabs: ImportedTab[] } {
  const zip = readZip(bytes);
  if (!zip.has('word/document.xml')) throw new ImportRefusal('not_docx', "This file isn't a Word document: it holds no document part.");
  const reader = new DocxReader(zip, images, notes);
  reader.load();
  const document = parseXml(zip.get('word/document.xml')!().toString('utf8'));
  const body = child(child(document, 'w:document'), 'w:body');
  if (!body) throw new ImportRefusal('not_docx', "This Word file is damaged: it holds no document body.");
  const content = reader.blocks(elements(body));
  content.push(...reader.noteBlocks());
  reader.finish();
  return { title: reader.title(), tabs: [{ make: ids => reader.make(content, ids) }] };
}
