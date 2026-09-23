// ============================================================================
// A pixel-art UI font, built as a real TrueType file in memory at load time.
//
// The whole interface wants to look hand-drawn on a grid, and no web-safe font
// does that — system monospace faces are anti-aliased outlines that fight the
// blocky art. Rather than ship a font file (and rather than draw every label
// into a canvas, which would mean rewriting the entire DOM UI), the glyphs
// below are assembled into a glyf-based TTF and handed to the FontFace API.
// The browser's font sanitiser is a strict validator, so `font.load()`
// rejecting is a genuine signal that the file is malformed — the caller falls
// back to the monospace stack in that case.
//
// Design grid: 5 wide, 7 tall above the baseline, with an optional 8th row for
// descenders. Advance width is trimmed to the ink, so the face is proportional
// the way a good pixel font should be.
// ============================================================================

/** char -> rows of '#' / '.', top row first. A 8th row hangs below the baseline. */
export const GLYPHS = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '"': ['.#.#.', '.#.#.', '.....', '.....', '.....', '.....', '.....'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  ',': ['.....', '.....', '.....', '.....', '.....', '..##.', '..#..', '.#...'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..##.', '....#', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
  ';': ['.....', '..#..', '..#..', '.....', '..##.', '..#..', '.#...'],
  '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.###.'],
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  'D': ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'I': ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  'J': ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  'N': ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  'S': ['.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.'],
  'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '[': ['..###', '..#..', '..#..', '..#..', '..#..', '..#..', '..###'],
  '\\': ['#....', '#....', '.#...', '..#..', '...#.', '....#', '....#'],
  ']': ['###..', '..#..', '..#..', '..#..', '..#..', '..#..', '###..'],
  '^': ['..#..', '.#.#.', '#...#', '.....', '.....', '.....', '.....'],
  '_': ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '`': ['.#...', '..#..', '.....', '.....', '.....', '.....', '.....'],
  'a': ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  'b': ['#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
  'c': ['.....', '.....', '.###.', '#....', '#....', '#...#', '.###.'],
  'd': ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
  'e': ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  'f': ['..##.', '.#..#', '.#...', '###..', '.#...', '.#...', '.#...'],
  'g': ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#', '.###.'],
  'h': ['#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#'],
  'i': ['..#..', '.....', '.##..', '..#..', '..#..', '..#..', '.###.'],
  'j': ['...#.', '.....', '..##.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  'k': ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
  'l': ['.##..', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  'm': ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  'n': ['.....', '.....', '####.', '#...#', '#...#', '#...#', '#...#'],
  'o': ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  'p': ['.....', '.....', '####.', '#...#', '#...#', '####.', '#....', '#....'],
  'q': ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#', '....#'],
  'r': ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  's': ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'],
  't': ['.#...', '.#...', '###..', '.#...', '.#...', '.#..#', '..##.'],
  'u': ['.....', '.....', '#...#', '#...#', '#...#', '#...#', '.####'],
  'v': ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'w': ['.....', '.....', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  'x': ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  'y': ['.....', '.....', '#...#', '#...#', '#...#', '.####', '....#', '###..'],
  'z': ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],
  '{': ['...#.', '..#..', '..#..', '.#...', '..#..', '..#..', '...#.'],
  '|': ['..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  '}': ['.#...', '..#..', '..#..', '...#.', '..#..', '..#..', '.#...'],
  '~': ['.....', '.....', '.#..#', '#.#.#', '#..#.', '.....', '.....'],
};

export const FONT_FAMILY = 'ChugCraft Pixel';

const FIRST = 0x20;                 // space
const LAST = 0x7e;                  // tilde
const UPEM = 1024;                  // units per em
const PX = 128;                     // font units per design pixel (8 px per em)
const TOP = 7;                      // design rows above the baseline
const ASCENT = TOP * PX;            // 896
const DESCENT = 1 * PX;             // 128
const LINE_GAP = PX;

// ---------------------------------------------------------------------------
// Binary writer
// ---------------------------------------------------------------------------
class Writer {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 0xff); }
  u16(v) { this.u8(v >> 8); this.u8(v); }
  i16(v) { this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v) { this.u16((v >>> 16) & 0xffff); this.u16(v & 0xffff); }
  tag(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  str16(s) { for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i)); }
  raw(arr) { for (const v of arr) this.b.push(v & 0xff); }
  out() { return new Uint8Array(this.b); }
  get length() { return this.b.length; }
}

function pad4(a) {
  if (a.length % 4 === 0) return a;
  const out = new Uint8Array(a.length + (4 - (a.length % 4)));
  out.set(a);
  return out;
}

function checksum(data) {
  const d = pad4(data);
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
    sum = (sum + v) >>> 0;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Outlines
// ---------------------------------------------------------------------------

/**
 * Turn a bitmap into axis-aligned rectangles. Consecutive lit pixels on a row
 * merge into one rectangle, which roughly thirds the point count — welcome,
 * because `maxp` has to declare the worst case and rasterisers care.
 */
function rectsFor(rows) {
  const out = [];
  for (let r = 0; r < rows.length; r++) {
    const line = rows[r];
    let c = 0;
    while (c < line.length) {
      if (line[c] !== '#') { c++; continue; }
      let end = c;
      while (end + 1 < line.length && line[end + 1] === '#') end++;
      out.push({ x0: c, x1: end + 1, y0: TOP - r - 1, y1: TOP - r });
      c = end + 1;
    }
  }
  return out;
}

/** A glyph: trimmed to its ink, with a one-pixel right side bearing. */
function buildGlyph(ch) {
  const rows = GLYPHS[ch] || GLYPHS['?'];
  let rects = rectsFor(rows);
  if (!rects.length) {
    // space and friends: no outline, just an advance
    return { contours: [], advance: 4 * PX, lsb: 0, xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0 };
  }
  const minX = Math.min(...rects.map((r) => r.x0));
  const maxX = Math.max(...rects.map((r) => r.x1));
  rects = rects.map((r) => ({ ...r, x0: r.x0 - minX, x1: r.x1 - minX }));
  const contours = rects.map((r) => ([
    // clockwise with y up: up the left edge, across the top, down the right
    [r.x0 * PX, r.y0 * PX], [r.x0 * PX, r.y1 * PX],
    [r.x1 * PX, r.y1 * PX], [r.x1 * PX, r.y0 * PX],
  ]));
  const xs = contours.flat().map((p) => p[0]);
  const ys = contours.flat().map((p) => p[1]);
  return {
    contours,
    advance: (maxX - minX + 1) * PX,
    lsb: 0,
    xMin: Math.min(...xs), yMin: Math.min(...ys),
    xMax: Math.max(...xs), yMax: Math.max(...ys),
    points: contours.length * 4,
  };
}

function glyphData(g) {
  if (!g.contours.length) return new Uint8Array(0);   // empty outline is legal
  const w = new Writer();
  w.i16(g.contours.length);
  w.i16(g.xMin); w.i16(g.yMin); w.i16(g.xMax); w.i16(g.yMax);
  let end = -1;
  for (const c of g.contours) { end += c.length; w.u16(end); }
  w.u16(0);                                            // no instructions
  const pts = g.contours.flat();
  for (let i = 0; i < pts.length; i++) w.u8(0x01);      // every point on-curve
  let prev = 0;
  for (const p of pts) { w.i16(p[0] - prev); prev = p[0]; }
  prev = 0;
  for (const p of pts) { w.i16(p[1] - prev); prev = p[1]; }
  return pad4(w.out());
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
function nameTable(family) {
  const records = [
    [1, family], [2, 'Regular'], [3, `ChugCraft:${family}`], [4, family],
    [5, 'Version 1.0'], [6, family.replace(/\s+/g, '')],
  ];
  const strings = new Writer();
  const offsets = records.map(([, s]) => {
    const off = strings.length;
    strings.str16(s);
    return { off, len: s.length * 2 };
  });
  const w = new Writer();
  w.u16(0);                       // format
  w.u16(records.length);
  w.u16(6 + records.length * 12); // storage offset
  records.forEach(([id], i) => {
    w.u16(3); w.u16(1); w.u16(0x0409); w.u16(id);
    w.u16(offsets[i].len); w.u16(offsets[i].off);
  });
  w.raw(strings.out());
  return w.out();
}

function cmapTable() {
  const w = new Writer();
  w.u16(0); w.u16(1);                    // version, one encoding record
  w.u16(3); w.u16(1); w.u32(12);         // Windows / BMP, subtable at 12
  // format 4 with a single contiguous run plus the mandatory 0xFFFF terminator
  w.u16(4); w.u16(32); w.u16(0);
  w.u16(4); w.u16(4); w.u16(1); w.u16(0);
  w.u16(LAST); w.u16(0xffff);            // endCode
  w.u16(0);                              // reservedPad
  w.u16(FIRST); w.u16(0xffff);           // startCode
  w.i16(1 - FIRST); w.u16(1);            // idDelta: glyph = char - 0x20 + 1
  w.u16(0); w.u16(0);                    // idRangeOffset
  return w.out();
}

function os2Table(glyphs, xAvg) {
  const w = new Writer();
  w.u16(4);                 // version
  w.i16(xAvg);
  w.u16(400); w.u16(5); w.u16(0);                       // weight, width, fsType
  w.i16(650); w.i16(700); w.i16(0); w.i16(140);         // subscript
  w.i16(650); w.i16(700); w.i16(0); w.i16(477);         // superscript
  w.i16(PX); w.i16(3 * PX);                             // strikeout
  w.i16(0);                                             // sFamilyClass
  w.raw([2, 0, 5, 9, 0, 0, 0, 0, 0, 0]);                // PANOSE: monospace-ish
  w.u32(1); w.u32(0); w.u32(0); w.u32(0);               // unicode ranges (latin)
  w.tag('CRVS');
  w.u16(0x0040);                                        // fsSelection: regular
  w.u16(FIRST); w.u16(LAST);
  w.i16(ASCENT); w.i16(-DESCENT); w.i16(LINE_GAP);
  w.u16(ASCENT); w.u16(DESCENT);
  w.u32(1); w.u32(0);                                   // code page: latin-1
  w.i16(5 * PX); w.i16(7 * PX);                         // x-height, cap height
  w.u16(0); w.u16(FIRST);
  w.u16(1);
  void glyphs;
  return w.out();
}

/** Assemble the whole font file. Returns an ArrayBuffer ready for FontFace. */
export function buildFontFile(family = FONT_FAMILY) {
  const chars = [];
  for (let c = FIRST; c <= LAST; c++) chars.push(String.fromCharCode(c));

  const glyphs = [{ contours: [], advance: 4 * PX, lsb: 0, xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0 }];
  for (const ch of chars) glyphs.push(buildGlyph(ch));
  const numGlyphs = glyphs.length;

  // glyf + loca
  const glyf = new Writer();
  const loca = [];
  for (const g of glyphs) {
    loca.push(glyf.length);
    glyf.raw(glyphData(g));
  }
  loca.push(glyf.length);
  const locaW = new Writer();
  for (const off of loca) locaW.u32(off);

  const inked = glyphs.filter((g) => g.contours.length);
  const xMin = Math.min(0, ...inked.map((g) => g.xMin));
  const yMin = Math.min(0, ...inked.map((g) => g.yMin));
  const xMax = Math.max(1, ...inked.map((g) => g.xMax));
  const yMax = Math.max(1, ...inked.map((g) => g.yMax));
  const maxAdvance = Math.max(...glyphs.map((g) => g.advance));
  const xAvg = Math.round(glyphs.reduce((a, g) => a + g.advance, 0) / numGlyphs);

  const head = new Writer();
  head.u32(0x00010000); head.u32(0x00010000);
  head.u32(0);                                  // checkSumAdjustment, patched later
  head.u32(0x5f0f3cf5);
  head.u16(0x000b);                             // flags: baseline at 0, lsb at 0
  head.u16(UPEM);
  head.u32(0); head.u32(0);                     // created
  head.u32(0); head.u32(0);                     // modified
  head.i16(xMin); head.i16(yMin); head.i16(xMax); head.i16(yMax);
  head.u16(0); head.u16(8); head.i16(2);        // macStyle, lowestRecPPEM, dirHint
  head.i16(1);                                  // long loca
  head.i16(0);

  const hhea = new Writer();
  hhea.u32(0x00010000);
  hhea.i16(ASCENT); hhea.i16(-DESCENT); hhea.i16(LINE_GAP);
  hhea.u16(maxAdvance);
  hhea.i16(0); hhea.i16(0); hhea.i16(xMax);
  hhea.i16(1); hhea.i16(0); hhea.i16(0);
  hhea.i16(0); hhea.i16(0); hhea.i16(0); hhea.i16(0);
  hhea.i16(0);
  hhea.u16(numGlyphs);

  const maxp = new Writer();
  maxp.u32(0x00010000);
  maxp.u16(numGlyphs);
  maxp.u16(Math.max(4, ...glyphs.map((g) => g.points)));
  maxp.u16(Math.max(1, ...glyphs.map((g) => g.contours.length)));
  maxp.u16(0); maxp.u16(0);
  maxp.u16(2); maxp.u16(0);
  maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0);
  maxp.u16(0); maxp.u16(0);

  const hmtx = new Writer();
  for (const g of glyphs) { hmtx.u16(g.advance); hmtx.i16(g.lsb); }

  const post = new Writer();
  post.u32(0x00030000);
  post.u32(0);                                  // italic angle
  post.i16(-PX); post.i16(PX);                  // underline position/thickness
  post.u32(1);                                  // isFixedPitch: no
  post.u32(0); post.u32(0); post.u32(0); post.u32(0);

  const tables = [
    ['OS/2', os2Table(glyphs, xAvg)],
    ['cmap', cmapTable()],
    ['glyf', glyf.out()],
    ['head', head.out()],
    ['hhea', hhea.out()],
    ['hmtx', hmtx.out()],
    ['loca', locaW.out()],
    ['maxp', maxp.out()],
    ['name', nameTable(family)],
    ['post', post.out()],
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const n = tables.length;
  let entrySelector = 0;
  while ((1 << (entrySelector + 1)) <= n) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;

  const dirSize = 12 + n * 16;
  let offset = dirSize;
  const placed = tables.map(([tag, data]) => {
    const rec = { tag, data, offset, length: data.length };
    offset += pad4(data).length;
    return rec;
  });

  const file = new Uint8Array(offset);
  const dir = new Writer();
  dir.u32(0x00010000);
  dir.u16(n); dir.u16(searchRange); dir.u16(entrySelector);
  dir.u16(n * 16 - searchRange);
  for (const rec of placed) {
    dir.tag(rec.tag);
    dir.u32(checksum(rec.data));
    dir.u32(rec.offset);
    dir.u32(rec.length);
  }
  file.set(dir.out(), 0);
  for (const rec of placed) file.set(pad4(rec.data), rec.offset);

  // head.checkSumAdjustment closes the loop over the finished file
  const headRec = placed.find((r) => r.tag === 'head');
  const adjust = (0xb1b0afba - checksum(file)) >>> 0;
  const dv = new DataView(file.buffer);
  dv.setUint32(headRec.offset + 8, adjust);
  return file.buffer;
}

/**
 * Register the font and point the UI's --font variable at it. Resolves to
 * false (leaving the monospace fallback in place) if the browser rejects the
 * generated file for any reason, so a bad build can never blank the interface.
 */
export async function installPixelFont() {
  try {
    if (typeof FontFace !== 'function' || !document.fonts) return false;
    const face = new FontFace(FONT_FAMILY, buildFontFile(), { style: 'normal', weight: '400' });
    await face.load();
    document.fonts.add(face);
    document.documentElement.style.setProperty(
      '--font', `"${FONT_FAMILY}", "Lucida Console", "DejaVu Sans Mono", monospace`);
    return true;
  } catch (e) {
    console.warn('pixel font unavailable, falling back to monospace:', e && e.message);
    return false;
  }
}
