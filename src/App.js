import React, { useState, useCallback, useEffect, useMemo } from 'react';
import './App.css';

import generatePDF, { getLinesPerPage } from './lib/generate-pdf';
import { parse, transpose, prettyPrint } from 'chord-magic';

// ── #1 Updated snippet — copies content directly to clipboard ────────────────
const DEVTOOLS_SNIPPET = `(function(){const t=window.UGAPP.store.page.data.tab_view.wiki_tab;const el=document.createElement('textarea');el.value=t.content;document.body.appendChild(el);el.select();document.execCommand('copy');document.body.removeChild(el);console.log('Copied to clipboard!');})();`;

// ── Key signature data ────────────────────────────────────────────────────────

const MAJOR_KEYS = [
  { label: 'C Major',  value: 'C Major',  useFlats: false },
  { label: 'Db Major', value: 'Db Major', useFlats: true  },
  { label: 'D Major',  value: 'D Major',  useFlats: false },
  { label: 'Eb Major', value: 'Eb Major', useFlats: true  },
  { label: 'E Major',  value: 'E Major',  useFlats: false },
  { label: 'F Major',  value: 'F Major',  useFlats: true  },
  { label: 'Gb Major', value: 'Gb Major', useFlats: true  },
  { label: 'G Major',  value: 'G Major',  useFlats: false },
  { label: 'Ab Major', value: 'Ab Major', useFlats: true  },
  { label: 'A Major',  value: 'A Major',  useFlats: false },
  { label: 'Bb Major', value: 'Bb Major', useFlats: true  },
  { label: 'B Major',  value: 'B Major',  useFlats: false },
];

const MINOR_KEYS = [
  { label: 'C Minor',  value: 'C Minor',  useFlats: true  },
  { label: 'C# Minor', value: 'C# Minor', useFlats: false },
  { label: 'D Minor',  value: 'D Minor',  useFlats: true  },
  { label: 'Eb Minor', value: 'Eb Minor', useFlats: true  },
  { label: 'E Minor',  value: 'E Minor',  useFlats: false },
  { label: 'F Minor',  value: 'F Minor',  useFlats: true  },
  { label: 'F# Minor', value: 'F# Minor', useFlats: false },
  { label: 'G Minor',  value: 'G Minor',  useFlats: true  },
  { label: 'G# Minor', value: 'G# Minor', useFlats: false },
  { label: 'A Minor',  value: 'A Minor',  useFlats: false },
  { label: 'Bb Minor', value: 'Bb Minor', useFlats: true  },
  { label: 'B Minor',  value: 'B Minor',  useFlats: false },
];

const ALL_KEY_OPTIONS = [...MAJOR_KEYS, ...MINOR_KEYS];

const KEY_USES_FLATS = Object.fromEntries(
  ALL_KEY_OPTIONS.map(k => [k.value, k.useFlats])
);

const ROOT_TO_INDEX = {
  'C': 0, 'C#': 1, 'Db': 1,
  'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8,
  'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11,
};

function findTransposedKey(baseKeyValue, steps) {
  if (steps === 0) return baseKeyValue;
  const keyEntry = ALL_KEY_OPTIONS.find(k => k.value === baseKeyValue);
  if (!keyEntry) return baseKeyValue;
  const isMinor = baseKeyValue.includes('Minor');
  const rootMatch = baseKeyValue.match(/^([A-G][b#]?)/);
  if (!rootMatch) return baseKeyValue;
  const root = rootMatch[1];
  const baseIdx = ROOT_TO_INDEX[root];
  if (baseIdx === undefined) return baseKeyValue;
  const newIdx = ((baseIdx + steps) % 12 + 12) % 12;
  const candidates = ALL_KEY_OPTIONS.filter(k => {
    const km = k.value.match(/^([A-G][b#]?)/);
    if (!km) return false;
    const kidx = ROOT_TO_INDEX[km[1]];
    return kidx === newIdx && k.value.includes(isMinor ? 'Minor' : 'Major');
  });
  if (candidates.length === 1) return candidates[0].value;
  if (candidates.length > 1) {
    const preferred = candidates.find(c => c.useFlats === keyEntry.useFlats);
    return (preferred || candidates[0]).value;
  }
  return baseKeyValue;
}

const SHARPS_TONES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const FLATS_TONES  = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];

function getTones(halftoneStyle, keySignature) {
  if (halftoneStyle === 'FOLLOW_KEY') {
    return KEY_USES_FLATS[keySignature] ? FLATS_TONES : SHARPS_TONES;
  }
  return halftoneStyle === 'FLATS' ? FLATS_TONES : SHARPS_TONES;
}

// ── Preview page builder ──────────────────────────────────────────────────────

function lineIsChord(rawLine) {
  return rawLine.includes('[ch]');
}

function buildPreviewPages(raw, linesPerPage, layout, headerLines = 3) {
  if (!raw) return [];
  const allLines = raw.split(/\r?\n/);

  function safeSlice(lines, limit) {
    if (limit >= lines.length) return [lines, []];
    let cut = limit;
    if (cut > 0) {
      const lastKept = lines[cut - 1];
      const firstExcluded = lines[cut];
      if (lineIsChord(lastKept) && firstExcluded && !lineIsChord(firstExcluded)) cut -= 1;
    }
    return [lines.slice(0, cut), lines.slice(cut)];
  }

  if (layout === 'single') {
    const pages = [];
    let offset = 0;
    let first = true;
    while (offset < allLines.length) {
      const cap = first ? linesPerPage - headerLines : linesPerPage;
      first = false;
      const [slice] = safeSlice(allLines.slice(offset), cap);
      pages.push({ left: slice, right: null });
      offset += slice.length;
      if (slice.length === 0) offset++;
    }
    return pages;
  }

  const pages = [];
  let remaining = [...allLines];
  let isFirstPage = true;
  while (remaining.length > 0) {
    const pageCapacity = isFirstPage ? linesPerPage - headerLines : linesPerPage;
    isFirstPage = false;
    const isLastPage = remaining.length <= pageCapacity * 2;
    if (isLastPage && remaining.length <= pageCapacity) {
      pages.push({ left: remaining, right: null });
      remaining = [];
    } else {
      const [leftLines, afterLeft] = safeSlice(remaining, pageCapacity);
      const [rightLines, afterRight] = safeSlice(afterLeft, pageCapacity);
      remaining = afterRight;
      pages.push({ left: leftLines, right: rightLines });
    }
  }
  return pages;
}

// ── Line renderer ─────────────────────────────────────────────────────────────

function renderRawLine(line, idx, chordColor = '#1a5a9a') {
  const stripped = line.replace(/\[tab\]/g, '').replace(/\[\/tab\]/g, '');
  const parts = stripped.split(/(\[ch\].*?\[\/ch\])/g);
  return (
    <div key={idx} className="chord-line">
      {parts.map((part, j) => {
        const m = part.match(/^\[ch\](.*?)\[\/ch\]$/);
        return m
          ? <b key={j} className="chord-token" style={{ color: chordColor }}>{m[1]}</b>
          : <span key={j}>{part}</span>;
      })}
    </div>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

const IconSingle = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <rect x="3" y="2" width="10" height="1.5" rx="0.5" />
    <rect x="3" y="5" width="10" height="1.5" rx="0.5" />
    <rect x="3" y="8" width="10" height="1.5" rx="0.5" />
    <rect x="3" y="11" width="7" height="1.5" rx="0.5" />
  </svg>
);

const IconDouble = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="2" width="6" height="1.5" rx="0.5" />
    <rect x="1" y="5" width="6" height="1.5" rx="0.5" />
    <rect x="1" y="8" width="6" height="1.5" rx="0.5" />
    <rect x="1" y="11" width="4" height="1.5" rx="0.5" />
    <rect x="9" y="2" width="6" height="1.5" rx="0.5" />
    <rect x="9" y="5" width="6" height="1.5" rx="0.5" />
    <rect x="9" y="8" width="6" height="1.5" rx="0.5" />
    <rect x="9" y="11" width="4" height="1.5" rx="0.5" />
  </svg>
);

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [rawInput, setRawInput] = useState('');
  const [chords, setChords] = useState('');
  const [artist, setArtist] = useState('');
  const [song, setSong] = useState('');

  const [halftoneStyle, setHalftoneStyle] = useState('FLATS');
  const [keySignature, setKeySignature] = useState('C Major');
  const [simplify, setSimplify] = useState(false);
  const [transposeStep, setTransposeStep] = useState(0);
  const [capo, setCapo] = useState(0);
  const [transposedChords, setTransposedChords] = useState('');
  const [copied, setCopied] = useState(false);

  const [layout, setLayout] = useState('single');
  const [density, setDensity] = useState('Normal');
  const [pageSize, setPageSize] = useState('A4');
  // Sheet display settings
  const [sheetDark, setSheetDark] = useState(true);
  const [chordColor, setChordColor] = useState('#1a5a9a');
  const [hexInput, setHexInput] = useState('#1a5a9a');

  // Effective key for FOLLOW_KEY tones resolution.
  // The capo offsets the written key upward, so to find the sounding key
  // we subtract capo from the keySignature first, then add transposeStep.
  const effectiveKey = useMemo(
    () => findTransposedKey(keySignature, transposeStep - capo),
    [keySignature, transposeStep, capo]
  );

  // Map display names to table keys
  const densityKey = density === 'Lesser' ? 'less' : density === 'More' ? 'more' : 'normal';
  const linesPerPage = getLinesPerPage(pageSize, densityKey);

  const downloadPdf = useCallback(
    () => generatePDF(artist, song, transposedChords, layout, densityKey, pageSize, chordColor),
    [artist, song, transposedChords, layout, densityKey, pageSize, chordColor]
  );

  const handleCopySnippet = useCallback(() => {
    navigator.clipboard.writeText(DEVTOOLS_SNIPPET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  useEffect(() => {
    if (rawInput) setChords(rawInput);
  }, [rawInput]);

  // Transpose effect
  useEffect(() => {
    const parseOptions = {};
    let transChords = chords.split(/\[ch\]|\[\/ch\]/g);
    let regex = [];
    const tones = getTones(halftoneStyle, effectiveKey);

    for (let i = 1; i <= transChords.length; i += 2) {
      const chord = transChords[i];
      if (chord) {
        try {
          const parsedChord = parse(chord, parseOptions);
          const transChord = transpose(parsedChord, transposeStep - capo);
          if (simplify) {
            delete transChord.extended;
            delete transChord.suspended;
            delete transChord.added;
            delete transChord.overridingRoot;
          }
          const prettyChord = prettyPrint(parsedChord, { naming: tones });
          const prettyTransChord = prettyPrint(transChord, { naming: tones });
          const chordsDiff = prettyTransChord.length - prettyChord.length;
          const chordsDiffPos = Math.abs(chordsDiff);
          const replacer = chordsDiff >= 0 ? '-'.repeat(chordsDiff) : ' '.repeat(chordsDiffPos);
          transChords[i] = `[ch]${prettyTransChord}[/ch]`;
          transChords[i] += replacer;
          if (chordsDiff >= 0) regex.push(replacer + ' '.repeat(chordsDiff));
        } catch (error) {
          console.info('failed to transpose', chord);
        }
      }
    }

    regex = regex.filter(r => r.length > 1);
    regex = [...new Set(regex)];

    transChords = transChords
      .join('')
      .replace(new RegExp(regex.join('|'), 'gm'), '')
      .replace(new RegExp('-+(\\n|\\r|\\S)', 'gm'), '$1')
      .replace(/\[\/ch\]\s\[ch\]/g, '[/ch]  [ch]')
      .replace(/\[\/ch\]\[ch\]/g, '[/ch] [ch]')
      .replace(/\[\/ch\](\w)/g, '[/ch] $1');

    setTransposedChords(transChords);
  }, [transposeStep, capo, chords, halftoneStyle, effectiveKey, simplify]);

  const previewPages = useMemo(
    () => buildPreviewPages(transposedChords, linesPerPage, layout),
    [transposedChords, linesPerPage, layout]
  );

  return (
    <>
      <div className="app-header">
        <h1>UGRIP</h1>
        <span>Ultimate Guitar Chord Extractor</span>
      </div>

      <div className="controls">

        {/* DevTools snippet */}
        <div>
          <div className="section-label">DevTools Snippet</div>
          <div className="devtools-hint">
            <code className="snippet-code">
              <span className="snip-paren">(</span>
              <span className="snip-keyword">function</span>
              <span className="snip-paren">(){'{'}{'{'}</span>
              <span className="snip-keyword">const </span>
              <span className="snip-var">t</span>
              <span className="snip-op">=</span>
              <span className="snip-obj">window</span>
              <span className="snip-op">.</span>
              <span className="snip-prop">UGAPP</span>
              <span className="snip-op">.</span>
              <span className="snip-prop">store</span>
              <span className="snip-op">.</span>
              <span className="snip-prop">page</span>
              <span className="snip-op">.</span>
              <span className="snip-prop">data</span>
              <span className="snip-op">.</span>
              <span className="snip-prop">tab_view</span>
              <span className="snip-op">.</span>
              <span className="snip-prop">wiki_tab</span>
              <span className="snip-paren">;</span>
              {' '}
              <span className="snip-keyword">const </span>
              <span className="snip-var">el</span>
              <span className="snip-op">=</span>
              <span className="snip-obj">document</span>
              <span className="snip-op">.</span>
              <span className="snip-fn">createElement</span>
              <span className="snip-paren">(</span>
              <span className="snip-str">'textarea'</span>
              <span className="snip-paren">);</span>
              {' '}
              <span className="snip-var">el</span>
              <span className="snip-op">.</span>
              <span className="snip-prop">value</span>
              <span className="snip-op">=</span>
              <span className="snip-var">t</span>
              <span className="snip-op">.</span>
              <span className="snip-prop">content</span>
              <span className="snip-paren">;</span>
              {' '}
              <span className="snip-obj">document</span>
              <span className="snip-op">.</span>
              <span className="snip-prop">body</span>
              <span className="snip-op">.</span>
              <span className="snip-fn">appendChild</span>
              <span className="snip-paren">(</span>
              <span className="snip-var">el</span>
              <span className="snip-paren">);</span>
              {' '}
              <span className="snip-var">el</span>
              <span className="snip-op">.</span>
              <span className="snip-fn">select</span>
              <span className="snip-paren">();</span>
              {' '}
              <span className="snip-obj">document</span>
              <span className="snip-op">.</span>
              <span className="snip-fn">execCommand</span>
              <span className="snip-paren">(</span>
              <span className="snip-str">'copy'</span>
              <span className="snip-paren">);</span>
              {' '}
              <span className="snip-obj">document</span>
              <span className="snip-op">.</span>
              <span className="snip-prop">body</span>
              <span className="snip-op">.</span>
              <span className="snip-fn">removeChild</span>
              <span className="snip-paren">(</span>
              <span className="snip-var">el</span>
              <span className="snip-paren">)</span>
              <span className="snip-paren">{'}'}})</span>
              <span className="snip-paren">();</span>
            </code>
            <button
              className={`btn btn-copy ${copied ? 'copied' : ''}`}
              onClick={handleCopySnippet}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', fontFamily: 'IBM Plex Mono, monospace' }}>
            Open UG tab → F12 → Console → paste → content copies to clipboard automatically
          </div>
        </div>

        <div className="divider" />

        {/* Raw input + Edit side by side */}
        <div className="textarea-row">
          <div className="textarea-box">
            <div className="section-label">Raw Input — paste console output here</div>
            <textarea
              className="raw-textarea"
              value={rawInput}
              onChange={e => setRawInput(e.target.value)}
              rows={6}
              placeholder="Paste chord data from DevTools console here..."
            />
          </div>
          <div className="textarea-box">
            <div className="section-label">Edit — trim or modify before processing</div>
            <textarea
              className="edit-textarea"
              value={chords}
              onChange={e => setChords(e.target.value)}
              rows={6}
              placeholder="Processed data appears here — edit freely..."
            />
          </div>
        </div>

        <div className="divider" />

        {/* Capo */}
        <div>
          <div className="section-label">Capo</div>
          <div className="capo-row">
            <button
              className="capo-btn"
              onClick={() => setCapo(c => Math.max(0, c - 1))}
              disabled={capo === 0}
            >−</button>
            <span className="capo-value">{capo === 0 ? 'No capo' : `Capo ${capo}`}</span>
            <button
              className="capo-btn"
              onClick={() => setCapo(c => Math.min(11, c + 1))}
              disabled={capo === 11}
            >+</button>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '11px', padding: '5px 10px' }}
              onClick={() => setCapo(0)}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Transpose */}
        <div>
          <div className="section-label">Transpose</div>
          <div className="transpose-row">
            <span className="transpose-label">
              Steps: <span>{transposeStep > 0 ? `+${transposeStep}` : transposeStep}</span>
            </span>
            <input
              type="range"
              className="transpose-slider"
              min={-12}
              max={12}
              step={1}
              value={transposeStep}
              onChange={e => setTransposeStep(parseInt(e.target.value, 10))}
            />
            <button
              className="btn btn-ghost"
              style={{ fontSize: '11px', padding: '5px 10px' }}
              onClick={() => setTransposeStep(0)}
            >
              Reset
            </button>

            {/* Show current sounding key when Follow Key Signature is active */}
            {halftoneStyle === 'FOLLOW_KEY' && (
              <span className="key-display key-display--active">
                In key of <strong>{effectiveKey}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Options */}
        <div>
          <div className="section-label">Options</div>
          <div className="options-row">

            <div className="options-group">
              <label>Halftones</label>
              <div className="radio-group">
                {[
                  { value: 'SHARPS',     label: 'Sharps' },
                  { value: 'FLATS',      label: 'Flats'  },
                  { value: 'FOLLOW_KEY', label: 'Follow Key Signature' },
                ].map(opt => (
                  <label key={opt.value} className="radio-option">
                    <input
                      type="radio"
                      name="halftoneStyle"
                      value={opt.value}
                      checked={halftoneStyle === opt.value}
                      onChange={e => setHalftoneStyle(e.target.value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>

              {halftoneStyle === 'FOLLOW_KEY' && (
                <div className="key-selector">
                  <select
                    className="style-select"
                    value={keySignature}
                    onChange={e => setKeySignature(e.target.value)}
                  >
                    <optgroup label="Major">
                      {MAJOR_KEYS.map(k => (
                        <option key={k.value} value={k.value}>{k.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Minor">
                      {MINOR_KEYS.map(k => (
                        <option key={k.value} value={k.value}>{k.label}</option>
                      ))}
                    </optgroup>
                  </select>
                  {transposeStep !== 0 && (
                    <span className="key-transposed-note">
                      → sounds in <strong>{effectiveKey}</strong>
                    </span>
                  )}
                  {capo > 0 && (
                    <span className="capo-key-reminder">
                      ⚠ Capo {capo} active — set key to the <em>sounding</em> key (written key − {capo} semitones)
                    </span>
                  )}
                </div>
              )}
            </div>

            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={simplify}
                onChange={e => setSimplify(e.target.checked)}
              />
              <span>Simplify chords</span>
            </label>

          </div>
        </div>

        <div className="divider" />

        {/* PDF Settings */}
        <div>
          <div className="section-label">PDF Settings</div>
          <div className="pdf-settings-row">

            <div className="pdf-setting-group">
              <span className="pdf-setting-label">Layout</span>
              <div className="layout-toggle">
                <button
                  className={`layout-btn ${layout === 'single' ? 'active' : ''}`}
                  onClick={() => setLayout('single')}
                  title="Single column"
                >
                  <IconSingle />
                  1 col
                </button>
                <button
                  className={`layout-btn ${layout === 'two-column' ? 'active' : ''}`}
                  onClick={() => setLayout('two-column')}
                  title="Two columns"
                >
                  <IconDouble />
                  2 col
                </button>
              </div>
            </div>

            <div className="pdf-setting-group">
              <span className="pdf-setting-label">Page size</span>
              <div className="layout-toggle">
                {['A4', 'A5', 'LETTER'].map(size => (
                  <button
                    key={size}
                    className={`layout-btn ${pageSize === size ? 'active' : ''}`}
                    onClick={() => setPageSize(size)}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            <div className="pdf-setting-group">
              <span className="pdf-setting-label">Density</span>
              <div className="layout-toggle">
                {['Lesser', 'Normal', 'More'].map(d => (
                  <button
                    key={d}
                    className={`layout-btn ${density === d ? 'active' : ''}`}
                    onClick={() => setDensity(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: 'var(--text-muted)' }}>
              {linesPerPage} lines/col
            </span>

          </div>
        </div>

        <div className="divider" />

        {/* Action buttons */}
        <div className="button-row">
          <button className="btn btn-primary" onClick={downloadPdf}>↓ Download PDF</button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setRawInput('');
              setChords('');
              setArtist('');
              setSong('');
              setTransposeStep(0);
              setCapo(0);
            }}
          >
            Clear all
          </button>
        </div>

      </div>

      {/* Sheet */}
      <div className={`sheet-wrapper ${sheetDark ? 'sheet-dark' : 'sheet-light'}`}>

        {/* Sheet toolbar: dark/light toggle + chord color picker */}
        <div className="sheet-toolbar">
          {/* Dark / Light toggle */}
          <div className="sheet-mode-toggle" onClick={() => setSheetDark(d => !d)} title="Toggle dark/light">
            <span className={`sheet-mode-opt ${sheetDark ? 'active' : ''}`}>Dark</span>
            <span className="sheet-mode-sep">·</span>
            <span className={`sheet-mode-opt ${!sheetDark ? 'active' : ''}`}>Light</span>
          </div>

          {/* Chord color picker */}
          <div className="chord-color-picker">
            <span className="chord-color-label">Chord color</span>
            {/* 5 preset swatches */}
            {['#1a5a9a', '#7a3a8a', '#1a7a4a', '#8a4a1a', '#7a2a2a'].map(c => (
              <button
                key={c}
                className={`color-swatch ${chordColor === c ? 'selected' : ''}`}
                style={{ background: c }}
                onClick={() => { setChordColor(c); setHexInput(c); }}
                title={c}
              />
            ))}
            {/* Hex input */}
            <span className="chord-color-hash">#</span>
            <input
              className="chord-hex-input"
              value={hexInput.replace('#', '')}
              maxLength={6}
              onChange={e => {
                const raw = e.target.value.replace(/[^0-9a-fA-F]/g, '');
                setHexInput('#' + raw);
                if (raw.length === 6) setChordColor('#' + raw);
              }}
            />
          </div>
        </div>

        <div className="sheet-header">
          <input
            className="sheet-song-input"
            value={song}
            onChange={e => setSong(e.target.value)}
            placeholder="Song name"
          />
          <input
            className="sheet-artist-input"
            value={artist}
            onChange={e => setArtist(e.target.value)}
            placeholder="Artist name"
          />
        </div>

        <div className="sheet-pages">
          {previewPages.length === 0 && (
            <div className="sheet-empty">Paste chord data above to see the preview</div>
          )}
          {previewPages.map((page, pi) => (
            <div key={pi} className="sheet-page">
              <div className="page-badge">Page {pi + 1}</div>
              <div className={`page-content ${page.right !== null ? 'two-col' : ''}`}>
                <div className="page-col">
                  {page.left.map((line, li) => renderRawLine(line, li, chordColor))}
                </div>
                {page.right !== null && (
                  <>
                    <div className="col-divider" />
                    <div className="page-col">
                      {page.right.map((line, li) => renderRawLine(line, li, chordColor))}
                    </div>
                  </>
                )}
              </div>
              {pi < previewPages.length - 1 && (
                <div className="page-break-marker">
                  <span>page break</span>
                </div>
              )}
            </div>
          ))}
          <div className="sheet-bottom-pad" />
        </div>
      </div>
    </>
  );
}

export default App;
