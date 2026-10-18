import { useCallback, useRef, useState } from 'react'
import { masterFile, reencode, validateFile, detectKind, type MasterResult } from './audio/client'
import { GENRES, MP3_BITRATES, type GenreId } from './audio/config'
import { buildZip, downloadBlob, safeName } from './audio/exportZip'
import CheckoutModal from './components/CheckoutModal'
import Player from './components/Player'
import { Checks, Decisions, StatsTable, Verdict } from './components/Report'

type Status = 'ready' | 'queued' | 'processing' | 'done' | 'error'
interface Track { id: string; file: File; genre: GenreId; status: Status; stage: string; pct: number; error?: string; result?: MasterResult; encoding?: boolean }

const base = (name: string) => safeName(name.replace(/\.[^.]+$/, ''))
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`

function outputs(t: Track, bitrate: number) {
  const r = t.result!
  const files = [{ name: `${base(t.file.name)} (Mastered) ${bitrate}kbps.mp3`, blob: r.mp3, label: `MP3 · ${bitrate} kbps` }]
  if (r.sourceKind === 'wav') files.unshift({ name: `${base(t.file.name)} (Mastered).wav`, blob: r.wav, label: `WAV · ${r.wavBits === 32 ? '32-bit float' : `${r.wavBits}-bit`} · ${(r.sampleRate / 1000).toFixed(1)} kHz` })
  return files
}

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [genre, setGenre] = useState<GenreId>('pop')
  const [bitrate, setBitrate] = useState<number>(320)
  const [phase, setPhase] = useState<'upload' | 'setup' | 'work'>('upload')
  const [notice, setNotice] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [paid, setPaid] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const running = useRef(false)

  const patch = (id: string, p: Partial<Track>) => setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)))

  const addFiles = (list: FileList | File[]) => {
    const ok: Track[] = [], bad: string[] = []
    for (const f of Array.from(list)) {
      const e = validateFile(f)
      if (e) bad.push(`${f.name}: ${e}`)
      else ok.push({ id: crypto.randomUUID(), file: f, genre, status: 'ready', stage: '', pct: 0 })
    }
    setNotice(bad.length ? bad.join('\n') : null)
    if (ok.length) { setTracks((ts) => [...ts, ...ok]); setPhase('setup') }
  }

  const runQueue = useCallback(async (queue: Track[]) => {
    if (running.current) return
    running.current = true
    for (const t of queue) {
      patch(t.id, { status: 'processing', stage: 'Starting', pct: 0, error: undefined })
      try {
        const result = await masterFile(t.file, t.genre, bitrate, (stage, pct) => patch(t.id, { stage, pct }))
        patch(t.id, { status: 'done', result, pct: 100, stage: 'Done' })
      } catch (e) {
        patch(t.id, { status: 'error', error: e instanceof Error ? e.message : 'Processing failed.' })
      }
    }
    running.current = false
  }, [bitrate])

  const start = () => {
    const q = tracks.map((t) => ({ ...t, status: 'queued' as Status }))
    setTracks(q); setPhase('work')
    if (q.length === 1) setOpen(q[0].id)
    void runQueue(q)
  }
  const retry = (t: Track) => void runQueue([t])

  const changeBitrate = async (b: number) => {
    setBitrate(b)
    for (const t of tracks) {
      if (t.status !== 'done' || !t.result) continue
      patch(t.id, { encoding: true })
      try { patch(t.id, { result: await reencode(t.result, b), encoding: false }) } catch (e) { patch(t.id, { encoding: false, error: e instanceof Error ? e.message : 'Encoding failed.' }) }
    }
  }

  const reset = () => { setTracks([]); setPhase('upload'); setPaid(false); setOpen(null); setNotice(null) }

  const done = tracks.filter((t) => t.status === 'done')
  const allFinished = phase === 'work' && tracks.every((t) => t.status === 'done' || t.status === 'error')
  const batch = tracks.length > 1
  const encoding = tracks.some((t) => t.encoding)

  const downloadZip = async () => {
    setZipping(true)
    try {
      const files = done.flatMap((t) => outputs(t, bitrate))
      downloadBlob(await buildZip(files), 'Mastered tracks.zip')
    } finally { setZipping(false) }
  }

  return (
    <div className="min-h-screen">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(255,138,61,0.13),transparent)]" />
      <header className="relative mx-auto flex max-w-5xl items-center px-6 py-6">
        <button onClick={reset} className="flex items-center gap-2.5">
          <span className="flex h-6 items-end gap-[3px]">{[10, 18, 24, 14, 20].map((h, i) => <span key={i} className="w-[3px] rounded-full bg-glow" style={{ height: h }} />)}</span>
          <span className="text-lg font-semibold tracking-tight">Sheen</span>
        </button>
        <span className="ml-3 hidden text-sm text-mute sm:inline">Mastering for AI-generated music</span>
      </header>

      <main className="relative mx-auto max-w-5xl px-6 pb-32">
        {phase === 'upload' && (
          <section className="pt-10 sm:pt-16">
            <h1 className="max-w-3xl text-4xl font-medium leading-[1.05] tracking-tight sm:text-6xl">
              Your Suno track, <span className="text-glow">ready for streaming.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-mute">Carefully mastered to bring out the best in your song, ready to share with the world.</p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
              onClick={() => input.current?.click()}
              className={`mt-10 cursor-pointer rounded-3xl border border-dashed p-12 text-center transition sm:p-16 ${drag ? 'border-glow bg-glow/5' : 'border-white/15 bg-panel/60 hover:border-white/30'}`}
            >
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/5">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 16V4m0 0l-5 5m5-5l5 5M4 20h16" /></svg>
              </div>
              <div className="mt-5 text-lg font-medium">Drop a song here, or click to browse</div>
              <div className="mt-1.5 text-sm text-mute">WAV or MP3 · up to 500 MB · add several files to master a whole album</div>
            </div>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
              {[
                ['Analyzes first', 'Loudness, peaks, tone, stereo and low end are measured before anything is touched.'],
                ['Only what\u2019s needed', 'Each stage — EQ, de-harsh, bass mono, clipping — is skipped if your mix doesn\u2019t need it.'],
                ['Verified output', 'The rendered WAV and MP3 are re-measured: −1 dBTP ceiling, no clipping, real numbers.'],
              ].map(([t, d]) => (
                <div key={t} className="bg-ink p-6"><div className="text-sm font-medium">{t}</div><p className="mt-2 text-sm text-mute">{d}</p></div>
              ))}
            </div>
          </section>
        )}
        <input ref={input} type="file" accept=".wav,.wave,.mp3,audio/wav,audio/mpeg" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
        {notice && <pre className="mt-6 whitespace-pre-wrap rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 font-sans text-sm text-bad">{notice}</pre>}

        {phase === 'setup' && (
          <section className="pt-6">
            <h2 className="text-3xl font-medium tracking-tight">Choose a genre</h2>
            <p className="mt-2 text-mute">It sets the starting point — the analysis decides how much processing your song actually gets.</p>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {Object.values(GENRES).map((g) => (
                <button key={g.id} onClick={() => { setGenre(g.id); setTracks((ts) => ts.map((t) => ({ ...t, genre: g.id }))) }}
                  className={`rounded-2xl border p-4 text-left transition ${genre === g.id ? 'border-glow bg-glow/10' : 'border-line bg-panel hover:border-white/20'}`}>
                  <div className="font-medium">{g.label}</div>
                  <div className="mt-1 text-xs text-mute">{g.blurb}</div>
                </button>
              ))}
            </div>

            <div className="mt-10 flex items-end justify-between">
              <h3 className="text-sm font-medium">{tracks.length === 1 ? 'Your song' : `${tracks.length} songs`}</h3>
              <button onClick={() => input.current?.click()} className="text-sm text-glow-soft hover:text-glow">+ Add more</button>
            </div>
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-panel">
              {tracks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-mute">{detectKind(t.file)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.file.name}</span>
                  <span className="num hidden text-xs text-mute sm:inline">{mb(t.file.size)}</span>
                  {batch && (
                    <select value={t.genre} onChange={(e) => patch(t.id, { genre: e.target.value as GenreId })} className="rounded-lg border border-line bg-ink px-2 py-1 text-xs">
                      {Object.values(GENRES).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                    </select>
                  )}
                  <button aria-label="Remove" onClick={() => setTracks((ts) => { const n = ts.filter((x) => x.id !== t.id); if (!n.length) setPhase('upload'); return n })} className="px-1 text-mute hover:text-white">×</button>
                </li>
              ))}
            </ul>

            <BitratePicker value={bitrate} onChange={setBitrate} hasWav={tracks.some((t) => detectKind(t.file) === 'wav')} />

            <button onClick={start} className="mt-10 w-full rounded-full bg-glow py-4 text-lg font-medium text-ink transition hover:bg-glow-soft sm:w-auto sm:px-12">
              Master {tracks.length === 1 ? 'my song' : `${tracks.length} songs`}
            </button>
          </section>
        )}

        {phase === 'work' && (
          <section className="pt-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-3xl font-medium tracking-tight">{allFinished ? (done.length ? (done.length > 1 ? 'Your masters are ready' : 'Your master is ready') : 'Processing failed') : 'Mastering…'}</h2>
                <p className="mt-2 text-mute">{allFinished ? 'Listen, compare and download.' : 'Analysis, processing and verification run on real audio — this takes a moment per song.'}</p>
              </div>
              <button onClick={reset} className="rounded-full border border-line px-4 py-2 text-sm text-mute hover:text-white">Start over</button>
            </div>

            <ul className="mt-8 space-y-3">
              {tracks.map((t) => (
                <li key={t.id} className="rounded-2xl border border-line bg-panel/60">
                  <div className={`flex items-center gap-4 px-5 py-4 ${t.status === 'done' ? 'cursor-pointer' : ''}`} onClick={() => t.status === 'done' && setOpen(open === t.id ? null : t.id)}>
                    <StatusDot s={t.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.file.name}</div>
                      <div className="mt-0.5 text-xs text-mute">
                        {GENRES[t.genre].label} · {t.status === 'processing' ? t.stage : t.status === 'queued' ? 'Waiting' : t.status === 'error' ? 'Failed' : t.encoding ? 'Re-encoding MP3…' : `${t.result!.report.before.lufs.toFixed(1)} → ${t.result!.report.after.lufs.toFixed(1)} LUFS-I`}
                      </div>
                    </div>
                    {t.status === 'processing' && <span className="num text-xs text-mute">{Math.round(t.pct)}%</span>}
                    {t.status === 'error' && <button onClick={(e) => { e.stopPropagation(); retry(t) }} className="rounded-full bg-white px-4 py-1.5 text-sm text-ink">Retry</button>}
                    {t.status === 'done' && batch && <span className="text-xs text-mute">{open === t.id ? 'Hide' : 'Details'}</span>}
                  </div>
                  {t.status === 'processing' && (
                    <div className="mx-5 mb-4 h-1 overflow-hidden rounded-full bg-white/5">
                      <div className="relative h-full rounded-full bg-glow transition-[width] duration-500" style={{ width: `${Math.max(3, t.pct)}%` }}>
                        <div className="absolute inset-0 animate-[sweep_1.4s_linear_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                      </div>
                    </div>
                  )}
                  {t.status === 'error' && <p className="mx-5 mb-4 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{t.error}</p>}
                  {t.status === 'done' && t.result && open === t.id && (
                    <div className="space-y-4 border-t border-line p-5">
                      <Verdict r={t.result.report} />
                      <Player original={t.file} mastered={t.result.wav} peaksBefore={t.result.peaksBefore} peaksAfter={t.result.peaksAfter} />
                      {!batch && (
                        <div className="rounded-2xl border border-line bg-panel p-5">
                          <div className="flex flex-wrap items-center gap-3">
                            {outputs(t, bitrate).map((f) => (
                              <button key={f.name} disabled={t.encoding} onClick={() => downloadBlob(f.blob, f.name)} className="rounded-full bg-glow px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-glow-soft disabled:opacity-50">
                                Download {f.label}
                              </button>
                            ))}
                          </div>
                          <BitratePicker value={bitrate} onChange={changeBitrate} hasWav={t.result.sourceKind === 'wav'} compact />
                        </div>
                      )}
                      <div className="grid gap-4 lg:grid-cols-2">
                        <StatsTable r={t.result.report} />
                        <div className="space-y-4"><Checks r={t.result.report} mp3={t.result.mp3Check} /></div>
                      </div>
                      <Decisions r={t.result.report} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {phase === 'work' && batch && allFinished && done.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-4">
            <div className="text-sm">
              <div className="font-medium">{done.length} tracks mastered</div>
              <div className="text-xs text-mute">{tracks.some((t) => t.result?.sourceKind === 'wav') ? 'WAV + ' : ''}MP3 in one ZIP · works on Mac & Windows</div>
            </div>
            <select value={bitrate} disabled={encoding} onChange={(e) => changeBitrate(Number(e.target.value))} className="ml-auto rounded-full border border-line bg-panel px-3 py-2 text-sm">
              {MP3_BITRATES.map((b) => <option key={b} value={b}>MP3 {b} kbps</option>)}
            </select>
            <button disabled={zipping || encoding} onClick={() => (paid ? downloadZip() : setCheckout(true))} className="rounded-full bg-glow px-6 py-3 text-sm font-medium text-ink transition hover:bg-glow-soft disabled:opacity-50">
              {zipping ? 'Preparing ZIP…' : encoding ? 'Encoding…' : 'Download all (ZIP)'}
            </button>
          </div>
        </div>
      )}
      {checkout && <CheckoutModal count={done.length} onClose={() => setCheckout(false)} onPaid={() => { setPaid(true); setCheckout(false); void downloadZip() }} />}
    </div>
  )
}

function StatusDot({ s }: { s: Status }) {
  if (s === 'processing') return <span className="size-2.5 animate-pulse rounded-full bg-glow" />
  if (s === 'done') return <span className="size-2.5 rounded-full bg-good" />
  if (s === 'error') return <span className="size-2.5 rounded-full bg-bad" />
  return <span className="size-2.5 rounded-full bg-white/15" />
}

function BitratePicker({ value, onChange, hasWav, compact }: { value: number; onChange: (b: number) => void; hasWav: boolean; compact?: boolean }) {
  return (
    <div className={compact ? 'mt-4' : 'mt-8'}>
      {!compact && <h3 className="text-sm font-medium">MP3 quality</h3>}
      <p className={`text-xs text-mute ${compact ? '' : 'mt-1'}`}>{hasWav ? 'WAV uploads get a lossless WAV master plus an MP3.' : 'MP3 uploads are delivered as MP3.'} The MP3 is encoded once from the master and re-checked.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {MP3_BITRATES.map((b) => (
          <label key={b} className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm transition ${value === b ? 'border-glow bg-glow/10 text-white' : 'border-line text-mute hover:text-white'}`}>
            <input type="radio" name={compact ? 'br2' : 'br'} className="sr-only" checked={value === b} onChange={() => onChange(b)} />
            <span className="num">{b}</span> kbps{b === 320 ? ' · default' : ''}
          </label>
        ))}
      </div>
    </div>
  )
}
