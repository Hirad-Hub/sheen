import { useCallback, useEffect, useRef, useState } from 'react'
import { masterFile, reencode, validateFile, detectKind, type MasterResult } from './audio/client'
import { GENRES, MP3_BITRATES, type GenreId } from './audio/config'
import { buildZip, downloadBlob, safeName } from './audio/exportZip'
import CheckoutModal from './components/CheckoutModal'
import Player from './components/Player'
import { Checks, Decisions, StatsTable, Verdict } from './components/Report'
import { saveMasteringDraft } from './manualMastering/drafts'
import { createSharedResult } from './share/results'

type Status = 'ready' | 'queued' | 'processing' | 'done' | 'error'
interface Track { id: string; file: File; genre: GenreId; status: Status; stage: string; pct: number; error?: string; result?: MasterResult; encoding?: boolean }
interface ShareEntry { id: string; fileName: string; title: string; url: string }

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
  const [genre, setGenre] = useState<GenreId>('edm')
  const [bitrate, setBitrate] = useState<number>(320)
  const [phase, setPhase] = useState<'upload' | 'setup' | 'work'>('upload')
  const [notice, setNotice] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [paid, setPaid] = useState(false)
  const [shareEntries, setShareEntries] = useState<ShareEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('sheen-share-links') || '[]') as ShareEntry[] }
    catch { return [] }
  })
  const [sharingTrack, setSharingTrack] = useState<string | null>(null)
  const [zipping, setZipping] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const running = useRef(false)

  useEffect(() => {
    try { localStorage.setItem('sheen-share-links', JSON.stringify(shareEntries)) } catch { /* Keep sharing usable if local storage is unavailable. */ }
  }, [shareEntries])

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

  const shareTrack = async (track: Track) => {
    if (!track.result) return
    setSharingTrack(track.id); setNotice(null)
    try {
      const shared = await createSharedResult({ original: track.file, mastered: track.result.mp3, peaksBefore: track.result.peaksBefore, peaksAfter: track.result.peaksAfter })
      setShareEntries((entries) => [{ id: crypto.randomUUID(), fileName: track.file.name, ...shared }, ...entries])
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not create a share link. Please try again.')
    } finally { setSharingTrack(null) }
  }

  const copyShareLink = async (url: string) => {
    try { await navigator.clipboard.writeText(url) }
    catch { setNotice('Could not copy automatically. Select and copy the share link from the table.') }
  }

  const openManualMasteringPage = (track: Track) => {
    const tab = window.open('about:blank', '_blank')
    if (!tab) { setNotice('Please allow pop-ups to open the human mastering page.'); return }
    tab.document.title = 'Opening Sheen Human Mastering…'
    tab.document.body.innerHTML = '<main style="font:16px system-ui;padding:32px;background:#0a0a0b;color:#eee;min-height:100vh">Opening your mastering request…</main>'
    const draftId = crypto.randomUUID()
    void saveMasteringDraft(draftId, track.file).then(() => {
      const url = new URL(window.location.href)
      url.search = new URLSearchParams({ manualMastering: '1', draft: draftId }).toString()
      url.hash = ''
      tab.location.replace(url.toString())
    }).catch((e) => {
      tab.close()
      setNotice(e instanceof Error ? e.message : 'Could not open your mastering request. Please try again.')
    })
  }

  return (
    <div className="min-h-screen">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(255,109,13,0.13),transparent)]" />
      <header className="relative mx-auto flex max-w-5xl items-center px-6 py-6">
        <button onClick={reset} className="flex items-center gap-2.5">
          <span className="flex h-6 items-end gap-[3px]">{[10, 18, 24, 14, 20].map((h, i) => <span key={i} className="w-[3px] rounded-full bg-glow" style={{ height: h }} />)}</span>
          <span className="text-[19px] font-semibold tracking-tight">Sheen</span>
        </button>
        <span className="ml-3 hidden text-[15px] text-mute sm:inline">Mastering for AI-generated music</span>
        {phase === 'work' && allFinished && done.length === 1 && <button onClick={reset} className="ml-auto rounded-full border border-line px-4 py-2 text-[14px] text-mute transition hover:border-white/25 hover:text-white">Start over</button>}
      </header>

      <main className="relative mx-auto max-w-5xl px-6">
        {phase === 'upload' && (
          <section className="pt-10 text-center sm:pt-12">
            <h1 className="mx-auto max-w-3xl text-4xl font-medium leading-[1.05] tracking-tight sm:text-6xl">
              Your Suno track, <span className="text-glow">ready for streaming.</span>
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-[19px] text-mute">Make your song shine with careful mastering, ready for the world to hear.</p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
              onClick={() => input.current?.click()}
              className={`mt-8 flex h-[240px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed p-8 text-center transition ${drag ? 'border-glow bg-glow/5' : 'border-white/15 bg-panel/60 hover:border-white/30'}`}
            >
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/5">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 16V4m0 0l-5 5m5-5l5 5M4 20h16" /></svg>
              </div>
              <div className="mt-5 text-[19px] font-medium">Drop a song here, or click to browse</div>
              <div className="mt-1.5 text-[15px] text-mute">WAV or MP3 · up to 500 MB · add several files to master a whole album</div>
            </div>
            <div className="mt-10 grid sm:grid-cols-3">
              {[
                ['Advanced analysis', 'Measures all key aspects of your track, from loudness and tone to stereo image and low end.'],
                ['Mastering-grade processing', 'Applies only changes that genuinely improve your sound, keeping the final master as natural as possible.'],
                ['Ready to release', 'Verified and ready for YouTube, Spotify, X, and all major streaming platforms.'],
              ].map(([t, d]) => (
                <div key={t} className="bg-transparent p-6"><div className="text-[15px] font-medium">{t}</div><p className="mt-2 text-[15px] text-mute">{d}</p></div>
              ))}
            </div>
          </section>
        )}
        <input ref={input} type="file" accept=".wav,.wave,.mp3,audio/wav,audio/mpeg" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
        {notice && <pre className="mt-6 whitespace-pre-wrap rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 font-sans text-[15px] text-bad">{notice}</pre>}

        {phase === 'setup' && (
          <section className="pt-6">
            <div className="text-center">
              <h2 className="text-[31px] font-medium tracking-tight">Choose a genre</h2>
              <p className="mx-auto mt-2 max-w-2xl text-[17px] text-mute">It sets the starting point — the analysis decides how much processing your song actually gets.</p>
            </div>
            <div className="mt-8 space-y-8">
              <div>
                <ul className="mx-auto max-w-3xl divide-y divide-line rounded-2xl border border-line bg-panel">
                  {tracks.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-5 py-3.5">
                      <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] uppercase text-mute">{detectKind(t.file)}</span>
                      <span className="min-w-0 flex-1 truncate text-[15px]">{t.file.name}</span>
                      <span className="num hidden text-[13px] text-mute sm:inline">{mb(t.file.size)}</span>
                      {batch && (
                        <select value={t.genre} onChange={(e) => patch(t.id, { genre: e.target.value as GenreId })} className="rounded-lg border border-line bg-ink px-2 py-1 text-[13px]">
                          {Object.values(GENRES).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                        </select>
                      )}
                      <button aria-label="Remove" onClick={() => setTracks((ts) => { const n = ts.filter((x) => x.id !== t.id); if (!n.length) setPhase('upload'); return n })} className="px-1 text-mute transition hover:text-white">×</button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-5">
              {Object.values(GENRES).map((g) => (
                <button key={g.id} onClick={() => { setGenre(g.id); setTracks((ts) => ts.map((t) => ({ ...t, genre: g.id }))) }}
                  className={`rounded-2xl border p-4 text-left transition ${genre === g.id ? 'border-glow bg-glow/10' : 'border-line bg-panel hover:border-white/20'}`}>
                  <div className="text-[15px] font-medium">{g.label}</div>
                  <div className="mt-1 text-[13px] text-mute">{g.blurb}</div>
                </button>
              ))}
              </div>
            </div>

            <div className="mt-10 flex justify-center">
              <button onClick={start} className="w-full rounded-full bg-glow py-4 text-base font-medium text-ink transition hover:bg-[#e65f0c] sm:w-auto sm:px-12">
                Master {tracks.length === 1 ? 'my song' : `${tracks.length} songs`}
              </button>
            </div>
          </section>
        )}

        {phase === 'work' && (
          <section className={allFinished && done.length === 1 ? 'pt-0' : 'pt-6'}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              {!(allFinished && done.length === 1) && (
                <div>
                  <h2 className="text-[31px] font-medium tracking-tight">{allFinished ? (done.length ? (done.length > 1 ? 'Your masters are ready' : 'Your master is ready') : 'Processing failed') : 'Mastering…'}</h2>
                  <p className="mt-2 text-[17px] text-mute">{allFinished ? 'Listen, compare and download.' : 'Analysis, processing and verification run on real audio — this takes a moment per song.'}</p>
                </div>
              )}
              {allFinished && done.length !== 1 && <button onClick={reset} className="rounded-full border border-line px-4 py-2 text-[15px] text-mute transition hover:border-white/20 hover:text-white">Start over</button>}
            </div>

            <ul className={`${allFinished && done.length === 1 ? 'mt-0' : 'mt-8'} space-y-3`}>
              {tracks.map((t) => (
                <li key={t.id} className={!batch && allFinished && t.status === 'done' ? '' : 'rounded-2xl border border-line bg-panel/60'}>
                  {!(!batch && allFinished && t.status === 'done') && (
                    <div className={`flex items-center gap-4 px-5 py-4 ${t.status === 'done' ? 'cursor-pointer' : ''}`} onClick={() => t.status === 'done' && setOpen(open === t.id ? null : t.id)}>
                    <StatusDot s={t.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{t.file.name}</div>
                      <div className="mt-0.5 text-[13px] text-mute">
                        {GENRES[t.genre].label} · {t.status === 'processing' ? t.stage : t.status === 'queued' ? 'Waiting' : t.status === 'error' ? 'Failed' : t.encoding ? 'Re-encoding MP3…' : `${t.result!.report.before.lufs.toFixed(1)} → ${t.result!.report.after.lufs.toFixed(1)} LUFS-I`}
                      </div>
                    </div>
                    {t.status === 'processing' && <span className="num text-[13px] text-mute">{Math.round(t.pct)}%</span>}
                    {t.status === 'error' && <button onClick={(e) => { e.stopPropagation(); retry(t) }} className="rounded-full bg-white px-4 py-1.5 text-[15px] text-ink transition hover:bg-zinc-200">Retry</button>}
                    {t.status === 'done' && batch && <span className="text-[13px] text-mute">{open === t.id ? 'Hide' : 'Details'}</span>}
                  </div>
                  )}
                  {t.status === 'processing' && (
                    <div className="mx-5 mb-4 h-1 overflow-hidden rounded-full bg-white/5">
                      <div className="relative h-full rounded-full bg-glow transition-[width] duration-500" style={{ width: `${Math.max(3, t.pct)}%` }}>
                        <div className="absolute inset-0 animate-[sweep_1.4s_linear_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                      </div>
                    </div>
                  )}
                  {t.status === 'error' && <p className="mx-5 mb-4 rounded-xl bg-bad/10 px-3 py-2 text-[15px] text-bad">{t.error}</p>}
                  {t.status === 'done' && t.result && open === t.id && (
                    <div className={`space-y-4 ${!batch && allFinished ? '' : 'border-t border-line p-5'}`}>
                      <Verdict r={t.result.report} />
                      <Player original={t.file} mastered={t.result.wav} peaksBefore={t.result.peaksBefore} peaksAfter={t.result.peaksAfter} onStartOver={reset} headerAction={!batch ? <button disabled={sharingTrack === t.id} onClick={() => void shareTrack(t)} className="whitespace-nowrap rounded-full border border-line px-4 py-2 text-[14px] font-medium text-white transition hover:border-glow/60 hover:bg-white/5 disabled:cursor-wait disabled:opacity-50">{sharingTrack === t.id ? 'Uploading…' : 'Share results'}</button> : undefined}>
                        {!batch && (
                          <div className="border-t border-line pt-5">
                          <BitratePicker value={bitrate} onChange={changeBitrate} hasWav={t.result.sourceKind === 'wav'} compact />
                          <div className="mt-8 flex flex-wrap justify-center gap-3 pb-4">
                            {outputs(t, bitrate).map((f) => (
                              <button key={f.name} disabled={t.encoding} onClick={() => downloadBlob(f.blob, f.name)} className="rounded-full bg-glow px-8 py-4 text-base font-medium text-ink transition hover:bg-[#e65f0c] disabled:opacity-50">
                                Download {f.label}
                              </button>
                            ))}
                            <button onClick={() => openManualMasteringPage(t)} className="rounded-full bg-white px-5 py-4 text-base font-medium text-black transition hover:bg-zinc-200 sm:px-8">
                              Upgrade to Human Mastering
                            </button>
                          </div>
                          </div>
                        )}
                      </Player>
                      <div className="rounded-2xl border border-line bg-panel p-5">
                        <h3 className="text-center text-[19px] font-medium">Technical details</h3>
                        <p className="mt-1 text-center text-[15px] text-mute">A complete measurement and verification report for your master.</p>
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <StatsTable r={t.result.report} />
                          <Checks r={t.result.report} mp3={t.result.mp3Check} />
                        </div>
                        <div className="mt-4"><Decisions r={t.result.report} /></div>
                      </div>
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
            <div className="text-[15px]">
              <div className="font-medium">{done.length} tracks mastered</div>
              <div className="text-[13px] text-mute">{tracks.some((t) => t.result?.sourceKind === 'wav') ? 'WAV + ' : ''}MP3 in one ZIP · works on Mac & Windows</div>
            </div>
            <select value={bitrate} disabled={encoding} onChange={(e) => changeBitrate(Number(e.target.value))} className="ml-auto rounded-full border border-line bg-panel px-3 py-2 text-[15px]">
              {MP3_BITRATES.map((b) => <option key={b} value={b}>MP3 {b} kbps</option>)}
            </select>
            <button disabled={zipping || encoding} onClick={() => (paid ? downloadZip() : setCheckout(true))} className="rounded-full bg-glow px-6 py-3 text-[15px] font-medium text-ink transition hover:bg-[#e65f0c] disabled:opacity-50">
              {zipping ? 'Preparing ZIP…' : encoding ? 'Encoding…' : 'Download all (ZIP)'}
            </button>
          </div>
        </div>
      )}
      {checkout && <CheckoutModal count={done.length} onClose={() => setCheckout(false)} onPaid={() => { setPaid(true); setCheckout(false); void downloadZip() }} />}
        {shareEntries.length > 0 && <section className="mx-auto mb-12 mt-8 max-w-5xl rounded-2xl border border-line bg-panel p-5 sm:p-6">
          <h2 className="text-[19px] font-medium">Shared result links</h2>
          <p className="mt-1 text-[13px] text-mute">Short names are based on each original filename, with a unique suffix.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-left text-[13px]">
              <thead><tr className="border-b border-line text-mute"><th className="pb-2 pr-4 font-medium">Original file</th><th className="pb-2 pr-4 font-medium">Short name</th><th className="pb-2 pr-4 font-medium">Share link</th><th className="pb-2 text-right font-medium">Action</th></tr></thead>
              <tbody>{shareEntries.map((entry) => <tr key={entry.id} className="border-b border-line/60 last:border-0"><td className="max-w-[180px] truncate py-3 pr-4">{entry.fileName}</td><td className="whitespace-nowrap py-3 pr-4 text-mute">{entry.title}</td><td className="max-w-[260px] truncate py-3 pr-4"><a href={entry.url} target="_blank" rel="noreferrer" className="text-glow-soft underline decoration-glow/30 underline-offset-4 hover:decoration-glow">{entry.url}</a></td><td className="py-3 text-right"><button onClick={() => void copyShareLink(entry.url)} className="rounded-full border border-line px-3 py-1.5 transition hover:border-white/25">Copy</button></td></tr>)}</tbody>
            </table>
          </div>
        </section>}
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
    <div className={`${compact ? 'mt-4' : 'mt-8'} ${compact ? 'text-center' : ''}`}>
      {!compact && <h3 className="text-[15px] font-medium">MP3 quality</h3>}
      {hasWav && <p className={`text-[13px] text-mute ${compact ? '' : 'mt-1'}`}>WAV uploads get a lossless WAV master plus an MP3.</p>}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {MP3_BITRATES.map((b) => (
          <label key={b} className={`flex h-8 cursor-pointer items-center rounded-full border px-4 text-[14px] transition ${value === b ? 'border-glow bg-glow/10 text-white' : 'border-line text-mute hover:border-white/20 hover:text-white'}`}>
            <input type="radio" name={compact ? 'br2' : 'br'} className="sr-only" checked={value === b} onChange={() => onChange(b)} />
            <span className="num">{b}</span> kbps{b === 320 ? ' · default' : ''}
          </label>
        ))}
      </div>
    </div>
  )
}
