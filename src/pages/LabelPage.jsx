import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '@/api.js';
import { useAuth } from '@/auth.jsx';
import Label from '@/components/Label.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

const PRESETS = [
  { name: 'Spine 3 × 20 cm', w: 30, h: 200 },
  { name: 'Spine 4 × 20 cm', w: 40, h: 200 },
  { name: 'Spine 5 × 25 cm', w: 50, h: 250 },
  { name: 'Spine 2.5 × 15 cm', w: 25, h: 150 },
  { name: 'Front 10 × 5 cm', w: 100, h: 50 },
  { name: 'File tab 7 × 3 cm', w: 70, h: 30 },
  { name: 'File cover 9 × 4 cm', w: 90, h: 40 },
];
const MIN_MM = 10;
const MAX_MM = 400;
// A4 minus the 10mm print margins below.
const A4_AREA = { w: 190, h: 277 };
const MAX_MARGIN_MM = 20;
const BORDERS = {
  thin: { name: 'Thin line', css: '0.3mm solid #000' },
  thick: { name: 'Thick line', css: '0.8mm solid #000' },
  dashed: { name: 'Dashed (cut line)', css: '0.3mm dashed #000' },
  none: { name: 'None', css: 'none' },
};
const DEFAULT_LOOK = { margin: 2, border: 'thin' };
const LOOK_KEY = 'labelLook';

const boxLabel = (b) => ({
  id: b.id,
  head: 'FILE BOX',
  sub: b.area?.name ?? '',
  main: b.name,
  foot: new Date(b.createdAt).toLocaleDateString(),
});
const fileLabel = (f) => ({
  id: f.id,
  head: 'FILE',
  sub: f.fileNumber,
  subRatio: 0.5, // file number at half the file name's size
  main: f.name,
  foot: `${f.boxName} · ${f.areaName}`,
});

// /labels?ids=… prints file box labels (admins); /labels?files=… prints file labels (everyone).
export default function LabelPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const kind = params.has('files') ? 'file' : 'box';
  const ids = (params.get(kind === 'file' ? 'files' : 'ids') ?? '').split(',').filter(Boolean);
  const isAdmin = user.role === 'admin';
  const [labels, setLabels] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState('a4');
  const [size, setSize] = useState(null);
  const [saved, setSaved] = useState(null);
  // Margin and border are a per-person print preference, remembered in this browser.
  const [look, setLook] = useState(() => {
    try {
      return { ...DEFAULT_LOOK, ...JSON.parse(localStorage.getItem(LOOK_KEY)) };
    } catch {
      return DEFAULT_LOOK;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LOOK_KEY, JSON.stringify(look));
    } catch {}
  }, [look]);

  useEffect(() => {
    api.get('/settings').then((s) => {
      const initial = kind === 'file' ? { w: s.fileLabelWidthMm, h: s.fileLabelHeightMm } : { w: s.labelWidthMm, h: s.labelHeightMm };
      setSize(initial);
      setSaved(initial);
    });
  }, [kind]);

  useEffect(() => {
    if (kind === 'box' && !isAdmin) return setError('Only admins can print file box labels.');
    const load = kind === 'file' ? (id) => api.get(`/files/${id}`).then(fileLabel) : (id) => api.get(`/boxes/${id}`).then(boxLabel);
    Promise.all(ids.map(load))
      .then(setLabels)
      .catch((e) => setError(e.message));
  }, [params]);

  if (!size) return <p className="mt-[40vh] text-center text-muted-foreground">Loading…</p>;

  const w = Number(size.w);
  const h = Number(size.h);
  const m = Number(look.margin);
  const validMargin = m >= 0 && m <= MAX_MARGIN_MM;
  // On label paper the margin sits inside the paper, so the printed label shrinks by it on each side.
  const labelW = mode === 'label' ? w - 2 * m : w;
  const labelH = mode === 'label' ? h - 2 * m : h;
  const validSize =
    w >= MIN_MM && w <= MAX_MM && h >= MIN_MM && h <= MAX_MM && validMargin && labelW >= MIN_MM && labelH >= MIN_MM;
  const isSaved = saved && w === saved.w && h === saved.h;
  const tooBigForA4 = mode === 'a4' && validSize && !(w + 2 * m <= A4_AREA.w && h + 2 * m <= A4_AREA.h);
  const preset = PRESETS.find((p) => p.w === w && p.h === h)?.name ?? 'custom';

  const pageCss =
    mode === 'label' && validSize
      ? `@page { size: ${w}mm ${h}mm; margin: ${m}mm; }`
      : '@page { size: A4 portrait; margin: 10mm; }';

  async function saveDefault() {
    try {
      const s = await api.put('/settings', { kind, labelWidthMm: w, labelHeightMm: h });
      setSaved(kind === 'file' ? { w: s.fileLabelWidthMm, h: s.fileLabelHeightMm } : { w: s.labelWidthMm, h: s.labelHeightMm });
      setError('');
      setNotice(`Saved as the default ${kind === 'file' ? 'file' : 'file box'} label size.`);
    } catch (e) {
      setError(e.message);
    }
  }

  function choosePreset(name) {
    const p = PRESETS.find((x) => x.name === name);
    if (p) setSize({ w: p.w, h: p.h });
    setNotice('');
  }

  const setDim = (key) => (e) => {
    setSize((s) => ({ ...s, [key]: e.target.value }));
    setNotice('');
  };

  const numberInput = 'h-8 w-20';

  return (
    <div className={`label-page min-h-screen bg-muted p-4 mode-${mode}`}>
      <style>{pageCss}</style>
      <div className="no-print mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border bg-card p-3 text-sm shadow-sm">
        <Button variant="ghost" size="sm" asChild>
          {kind === 'file' ? <Link to="/"><ArrowLeft /> Files</Link> : <Link to="/admin"><ArrowLeft /> Admin</Link>}
        </Button>
        <label className="flex items-center gap-2">
          Size
          <NativeSelect size="sm" value={preset} onChange={(e) => choosePreset(e.target.value)}>
            {PRESETS.map((p) => <NativeSelectOption key={p.name} value={p.name}>{p.name}</NativeSelectOption>)}
            <NativeSelectOption value="custom" disabled>Custom</NativeSelectOption>
          </NativeSelect>
        </label>
        <span className="flex items-center gap-1.5">
          <Input className={numberInput} type="number" min={MIN_MM} max={MAX_MM} step="0.5" value={size.w} onChange={setDim('w')} aria-label="Width in mm" />
          ×
          <Input className={numberInput} type="number" min={MIN_MM} max={MAX_MM} step="0.5" value={size.h} onChange={setDim('h')} aria-label="Height in mm" />
          <span className="text-muted-foreground">mm (width × height)</span>
        </span>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={saveDefault} disabled={!validSize || isSaved}>
            {isSaved ? 'Default size' : 'Save as default'}
          </Button>
        )}
        <label className="flex items-center gap-2">
          Paper
          <NativeSelect size="sm" value={mode} onChange={(e) => setMode(e.target.value)}>
            <NativeSelectOption value="a4">A4 sheet (cut out)</NativeSelectOption>
            <NativeSelectOption value="label">Label paper (one label per page)</NativeSelectOption>
          </NativeSelect>
        </label>
        <span className="flex items-center gap-1.5">
          Margin
          <Input
            className={numberInput}
            type="number"
            min="0"
            max={MAX_MARGIN_MM}
            step="0.5"
            value={look.margin}
            onChange={(e) => setLook((l) => ({ ...l, margin: e.target.value }))}
            aria-label="Margin in mm"
          />
          <span className="text-muted-foreground">mm</span>
        </span>
        <label className="flex items-center gap-2">
          Border
          <NativeSelect size="sm" value={look.border} onChange={(e) => setLook((l) => ({ ...l, border: e.target.value }))}>
            {Object.entries(BORDERS).map(([key, b]) => <NativeSelectOption key={key} value={key}>{b.name}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <Button size="sm" onClick={() => window.print()} disabled={labels.length === 0 || !validSize}>
          <Printer /> Print
        </Button>
      </div>
      <div className="no-print mb-4 space-y-1 text-sm">
        <p className="text-muted-foreground">
          Print at 100% scale / "Actual size" so the label comes out exactly {validSize ? `${labelW} × ${labelH} mm` : 'the size set'}
          {validSize && m > 0 && (mode === 'label' ? `, ${m} mm in from each paper edge` : `, with ${m} mm of space around each label`)}.
        </p>
        {!validMargin && <p className="text-destructive">Margin must be between 0 and {MAX_MARGIN_MM} mm.</p>}
        {validMargin && !validSize && (
          <p className="text-destructive">
            Width and height must be between {MIN_MM} and {MAX_MM} mm
            {mode === 'label' && m > 0 ? `, and leave at least ${MIN_MM} mm of label inside the margins` : ''}.
          </p>
        )}
        {tooBigForA4 && <p className="text-destructive">This size doesn't fit on A4 ({A4_AREA.w} × {A4_AREA.h} mm printable). Use label paper instead.</p>}
        {error && <p className="text-destructive">{error}</p>}
        {notice && <p className="text-success">{notice}</p>}
      </div>
      {validSize && (
        <div className="label-sheet flex flex-wrap items-start" style={{ '--label-margin': `${m}mm`, '--label-border': BORDERS[look.border]?.css ?? BORDERS.thin.css }}>
          {labels.map(({ id, ...l }) => <Label key={id} {...l} widthMm={labelW} heightMm={labelH} />)}
        </div>
      )}
    </div>
  );
}
