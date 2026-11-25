// A font a test can tell from every other: each printable ASCII character is one solid square, the whole em box.
//
// blockFont() → the bytes of a TrueType font. Text set in it at `font: 40px/40px` is a solid bar 40 px high and 40 px
// wide per character; in any fallback font the same text ("....") leaves the top of its line empty. So one pixel near
// the top of the line says whether a picture of the page (an export, a snapshot) was drawn with the web font or
// without it. Built here, so the tests need no font file and no network.
//
// blockFont(family, { han: true }) also draws HAN_COUNT ideographs from U+4E00 as squares: enough of them that a
// picture inlines the font as a subset (export-kit font-subset.ts) rather than whole.
//
const UNITS = 1000;
const FIRST = 0x20;
const LAST = 0x7e;
export const HAN_FIRST = 0x4e00;
export const HAN_COUNT = 2000;

const u16 = (...values) => {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((value, i) => out.writeUInt16BE(value & 0xffff, i * 2));
  return out;
};
const u32 = (...values) => {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => out.writeUInt32BE(value >>> 0, i * 4));
  return out;
};
const padded = table => Buffer.concat([table, Buffer.alloc((4 - (table.length % 4)) % 4)]);
const checksum = table => {
  let sum = 0;
  for (let i = 0; i < table.length; i += 4) sum = (sum + table.readUInt32BE(i)) >>> 0;
  return sum;
};

export function blockFont(family = 'Block', { han = false } = {}) {
  const ascii = LAST - FIRST + 2; // .notdef, then one square per character
  const glyphs = ascii + (han ? HAN_COUNT : 0); // and one per ideograph

  // One contour: (0,0) (0,1000) (1000,1000) (1000,0), every point on the curve, coordinates as 16-bit deltas.
  const square = padded(Buffer.concat([u16(1, 0, 0, UNITS, UNITS), u16(3), u16(0), Buffer.from([1, 1, 1, 1]), u16(0, 0, UNITS, 0), u16(0, UNITS, 0, -UNITS)]));
  const glyf = Buffer.concat(Array.from({ length: glyphs - 1 }, () => square));
  // Short offsets (in words); .notdef has no outline.
  const loca = u16(0, ...Array.from({ length: glyphs }, (_, i) => (i * square.length) / 2));

  const head = Buffer.concat([u32(0x00010000, 0x00010000, 0, 0x5f0f3cf5), u16(0x0003, UNITS), u32(0, 0, 0, 0), u16(0, 0, UNITS, UNITS, 0, 8, 2, 0, 0)]);
  const hhea = Buffer.concat([u32(0x00010000), u16(UNITS, 0, 0, UNITS, 0, 0, UNITS, 1, 0, 0, 0, 0, 0, 0, 0, glyphs)]);
  const maxp = Buffer.concat([u32(0x00010000), u16(glyphs, 4, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0)]);
  const hmtx = u16(...Array.from({ length: glyphs }, () => [UNITS, 0]).flat());
  const os2 = Buffer.concat([
    u16(0, UNITS, 400, 5, 0),
    u16(650, 600, 0, 75, 650, 600, 0, 350, 50, 250),
    u16(0),
    Buffer.alloc(10),
    u32(1, 0, 0, 0),
    Buffer.from('TEST'),
    u16(0x0040, FIRST, han ? HAN_FIRST + HAN_COUNT - 1 : LAST, UNITS, 0, 0, UNITS, 0),
  ]);
  // Windows Unicode BMP, format 4: one segment for the characters (glyph = code − FIRST + 1), and the closing one;
  // with `han`, one for the ideographs between them (glyph = code − HAN_FIRST + ascii).
  const cmap = han
    ? Buffer.concat([u16(0, 1, 3, 1), u32(12), u16(4, 40, 0, 6, 4, 1, 2, LAST, HAN_FIRST + HAN_COUNT - 1, 0xffff, 0, FIRST, HAN_FIRST, 0xffff, 1 - FIRST, ascii - HAN_FIRST, 1, 0, 0, 0)])
    : Buffer.concat([u16(0, 1, 3, 1), u32(12), u16(4, 32, 0, 4, 4, 1, 0, LAST, 0xffff, 0, FIRST, 0xffff, 1 - FIRST, 1, 0, 0)]);
  const names = [[1, family], [2, 'Regular'], [3, `${family} test font`], [4, family], [6, family.replace(/\s+/g, '')]];
  const strings = names.map(([, text]) => Buffer.from(text, 'utf16le').swap16());
  let at = 0;
  const name = Buffer.concat([
    u16(0, names.length, 6 + names.length * 12),
    ...names.map(([id], i) => {
      const record = u16(3, 1, 0x409, id, strings[i].length, at);
      at += strings[i].length;
      return record;
    }),
    ...strings,
  ]);
  const post = Buffer.concat([u32(0x00030000, 0), u16(-100, 50), u32(1, 0, 0, 0, 0)]);

  const tables = Object.entries({ 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post }).map(([tag, data]) => ({ tag, data: padded(data), length: data.length }));
  const count = tables.length;
  const selector = Math.floor(Math.log2(count));
  const directory = [u32(0x00010000), u16(count, 16 << selector, selector, count * 16 - (16 << selector))];
  let offset = 12 + count * 16;
  for (const table of tables) {
    directory.push(Buffer.from(table.tag), u32(checksum(table.data), offset, table.length));
    table.offset = offset;
    offset += table.data.length;
  }
  const font = Buffer.concat([...directory, ...tables.map(table => table.data)]);
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, tables.find(table => table.tag === 'head').offset + 8);
  return font;
}
