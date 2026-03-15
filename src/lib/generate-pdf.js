import pdfMake from 'pdfmake/build/pdfmake';
import vfsFonts from './vfs_fonts';

pdfMake.vfs = vfsFonts.pdfMake.vfs;

pdfMake.fonts = {
  'Roboto Mono': {
    normal: 'RobotoMono-Regular.ttf',
    bold: 'RobotoMono-Bold.ttf',
  },
};

const isOdd = i => i % 2 === 1;

// How many lines the artist+song header occupies on page 1
const HEADER_LINES = 3;

/**
 * Lines per column per page, keyed by [pageSize][density].
 * density: 'less' | 'normal' | 'more'
 */
const LINES_TABLE = {
  LETTER: { less: 74, normal: 76, more: 78 },
  A5:     { less: 38, normal: 40, more: 42 },
  A4:     { less: 76, normal: 78, more: 80 },
};

export function getLinesPerPage(pageSize, density) {
  const sizeKey = pageSize in LINES_TABLE ? pageSize : 'A4';
  const densityKey = density in LINES_TABLE[sizeKey] ? density : 'normal';
  return LINES_TABLE[sizeKey][densityKey];
}

/**
 * Convert raw chord string into an array of pdfmake line nodes.
 * Each line is either a plain string or a { text: [...] } object.
 * We also tag each line with a `_isChordLine` boolean so we can
 * detect chord-line / lyric-line pairs when slicing columns.
 */
function processChords(chords, chordColor = '#1a5a9a') {
  let formattedChords = chords;
  formattedChords = formattedChords.replace(/\[tab\]/g, '');
  formattedChords = formattedChords.replace(/\[\/tab\]/g, '');

  const rawLines = formattedChords.split(/\n/g);
  const processed = [];

  for (let i = 0; i < rawLines.length; i++) {
    const parts = rawLines[i].split(/\[ch\]|\[\/ch\]/g);

    let node;
    let isChordLine = false;

    if (parts.length === 1) {
      // Plain text line
      node = parts[0];
    } else {
      // Line contains [ch] markers — it's a chord line
      isChordLine = true;
      for (let j = 0; j < parts.length; j++) {
        if (isOdd(j)) {
          parts[j] = { text: parts[j], bold: true, color: chordColor };
        }
      }
      node = { text: parts };
    }

    // Attach metadata (won't appear in PDF output, just used during slicing)
    if (typeof node === 'object') {
      node._isChordLine = isChordLine;
    } else {
      // Wrap plain strings so we can tag them too
      node = { text: node, _isChordLine: false };
    }

    processed.push(node);
  }

  return processed;
}

/**
 * Strip our internal _isChordLine tag before handing nodes to pdfmake.
 */
function stripMeta(nodes) {
  return nodes.map(n => {
    if (typeof n === 'string') return n;
    const { _isChordLine, ...clean } = n;
    return clean;
  });
}

/**
 * Given a flat line array and a max column size, slice off up to `limit` lines
 * from the start — but never let the last line of the slice be a chord line
 * that has a lyric line immediately following it (i.e. don't orphan a chord
 * from its lyric). If the last line would orphan a chord, back up by one.
 *
 * Returns [slicedLines, remainder].
 */
function safeSlice(lines, limit) {
  if (limit >= lines.length) return [lines, []];

  let cut = limit;

  // If the line just before the cut is a chord line and the line at the cut
  // is NOT a chord line (i.e. it's the accompanying lyric), bump cut back by 1
  // so the chord goes onto the next column/page with its lyric.
  if (cut > 0) {
    const lastKept = lines[cut - 1];
    const firstExcluded = lines[cut];
    const lastIsChord = typeof lastKept === 'object' && lastKept._isChordLine;
    const nextIsLyric = firstExcluded && (typeof firstExcluded === 'string' || !firstExcluded._isChordLine);

    if (lastIsChord && nextIsLyric) {
      cut -= 1;
    }
  }

  return [lines.slice(0, cut), lines.slice(cut)];
}

/**
 * Build two-column page chunks.
 *
 * Algorithm:
 * 1. Fill columns greedily, two columns per page, using safeSlice to avoid
 *    orphaning chord lines from their lyrics.
 * 2. On the very last page: if the remaining lines fit within one column,
 *    render them as a single column (no right column). Only use two columns
 *    if the content fills more than one column's worth.
 */
function buildTwoColumnContent(lines, linesPerPage) {
  const content = [];
  let remaining = [...lines];
  let isFirstPage = true;

  while (remaining.length > 0) {
    const pageCapacity = isFirstPage
      ? linesPerPage - HEADER_LINES
      : linesPerPage;
    isFirstPage = false;

    const isLastPage = remaining.length <= pageCapacity * 2;

    if (isLastPage && remaining.length <= pageCapacity) {
      // Everything fits in one column — render single column, no table
      content.push({ stack: stripMeta(remaining) });
      remaining = [];
    } else {
      // Slice left column
      const [leftLines, afterLeft] = safeSlice(remaining, pageCapacity);
      // Slice right column from whatever is left on this page
      const [rightLines, afterRight] = safeSlice(afterLeft, pageCapacity);
      remaining = afterRight;

      content.push({
        table: {
          widths: ['*', 16, '*'],
          body: [
            [
              { stack: stripMeta(leftLines), border: [false, false, false, false] },
              { text: '', border: [false, false, false, false] },
              { stack: stripMeta(rightLines), border: [false, false, false, false] },
            ],
          ],
        },
        layout: 'noBorders',
      });

      // Page break between pages (not after the last page)
      if (remaining.length > 0) {
        content.push({ text: '', pageBreak: 'after' });
      }
    }
  }

  return content;
}

/**
 * Main export.
 *
 * @param {string} artist
 * @param {string} song
 * @param {string} chords      - Raw chord string with [ch]/[tab] markup
 * @param {string} layout      - 'single' | 'two-column'
 * @param {string} density     - 'less' | 'normal' | 'more'
 * @param {string} pageSize    - 'A4' | 'A5' | 'LETTER'
 * @param {string} chordColor  - Hex color for bold chord tokens
 */
export default function generatePDF(
  artist,
  song,
  chords,
  layout = 'single',
  density = 'normal',
  pageSize = 'A4',
  chordColor = '#1a5a9a'
) {
  const linesPerPage = getLinesPerPage(pageSize, density);
  const fileName = `chords_${artist}_${song}`;
  const fileNameFormatted = fileName.replace(/\W/g, '-').toLocaleLowerCase();

  const lines = processChords(chords || '', chordColor);

  let contentBody;

  if (layout === 'two-column') {
    contentBody = buildTwoColumnContent(lines, linesPerPage);
  } else {
    contentBody = stripMeta(lines);
  }

  const docDefinition = {
    pageSize,
    // PDF always uses white background (no cream tint)
    background: () => ({
      canvas: [{ type: 'rect', x: 0, y: 0, w: 1000, h: 1200, color: '#ffffff' }],
    }),

    content: [
      { text: artist, style: 'artist' },
      { text: song, style: 'song' },
      ' ',
      ...contentBody,
    ],

    defaultStyle: {
      font: 'Roboto Mono',
      fontSize: 8,
      preserveLeadingSpaces: true,
    },

    styles: {
      artist: { fontSize: 12, bold: true },
      song: { fontSize: 10 },
    },

    // Single column: preserve original page-break logic
    pageBreakBefore:
      layout === 'single'
        ? (currentNode, followingNodesOnPage, nodesOnNextPage) => {
            const isLastOnPage = followingNodesOnPage.length === 0;
            const isNotLastOfAll = nodesOnNextPage.length !== 0;
            return isLastOnPage && isNotLastOfAll && Array.isArray(currentNode.text);
          }
        : undefined,
  };

  pdfMake.createPdf(docDefinition).download(fileNameFormatted);
}
