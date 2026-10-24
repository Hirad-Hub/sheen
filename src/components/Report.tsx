import type { MasterReport } from '../audio/master'
import type { Mp3Check } from '../audio/client'

const n = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞')

interface Row { label: string; hint: string; a: string; b: string; unit: string }

export function StatsTable({ r }: { r: MasterReport }) {
  const { before: x, after: y } = r
  const rows: Row[] = [
    { label: 'Integrated loudness', hint: 'LUFS-I', a: n(x.lufs), b: n(y.lufs), unit: 'LUFS' },
    { label: 'RMS level', hint: 'average energy', a: n(x.rmsDb), b: n(y.rmsDb), unit: 'dBFS' },
    { label: 'Crest factor', hint: 'peak to RMS', a: n(x.crestDb), b: n(y.crestDb), unit: 'dB' },
    { label: 'True peak', hint: 'BS.1770, 4× oversampled', a: n(x.truePeakDb, 2), b: n(y.truePeakDb, 2), unit: 'dBTP' },
    { label: 'Image separation', hint: 'side / mid width', a: n(x.widthPct, 0), b: n(y.widthPct, 0), unit: '%' },
    { label: 'Channel correlation', hint: '+1 mono · 0 wide · −1 out of phase', a: n(x.correlation, 2), b: n(y.correlation, 2), unit: '' },
    { label: 'Low-end correlation', hint: 'below 100 Hz', a: n(x.lowCorrelation, 2), b: n(y.lowCorrelation, 2), unit: '' },
    { label: 'DC offset', hint: 'max per channel', a: (x.dcOffset * 100).toFixed(3), b: (y.dcOffset * 100).toFixed(3), unit: '%' },
  ]
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="grid grid-cols-[1fr_88px_24px_88px] items-center gap-2 border-b border-line px-5 py-3 text-[12px] uppercase tracking-[0.14em] text-mute sm:grid-cols-[1fr_110px_24px_110px]">
        <span>Measurement</span><span className="text-right">Before</span><span /><span className="text-right text-glow-soft">After</span>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[1fr_88px_24px_88px] items-center gap-2 border-b border-line px-5 py-3 last:border-0 sm:grid-cols-[1fr_110px_24px_110px]">
          <div>
            <div className="text-[15px]">{row.label}</div>
            <div className="text-[13px] text-mute">{row.hint}</div>
          </div>
          <div className="num text-right text-[15px] text-mute">{row.a}<span className="ml-1 text-[11px]">{row.unit}</span></div>
          <div className="text-center text-mute/60">→</div>
          <div className="num text-right text-[15px] text-white">{row.b}<span className="ml-1 text-[11px] text-mute">{row.unit}</span></div>
        </div>
      ))}
    </div>
  )
}

const dot = { pass: 'bg-good', warn: 'bg-warn', fail: 'bg-bad' }

export function Checks({ r, mp3 }: { r: MasterReport; mp3: Mp3Check }) {
  const all = [
    ...r.checks,
    { label: `MP3 ${mp3.bitrate} kbps re-verified after encoding`, status: mp3.ok ? 'pass' : 'fail', detail: `${mp3.truePeakDb.toFixed(2)} dBTP${mp3.trimDb ? ` · trimmed ${mp3.trimDb.toFixed(1)} dB` : ''}` } as const,
  ]
  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <h4 className="text-[15px] font-medium">Final verification</h4>
      <p className="mt-1 text-[13px] text-mute">Measured on the rendered files, not on the processing settings.</p>
      <ul className="mt-4 space-y-2.5">
        {all.map((c) => (
          <li key={c.label} className="flex items-start gap-3 text-[15px]">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot[c.status]}`} />
            <span className="flex-1">{c.label}</span>
            <span className="num text-right text-[13px] text-mute">{c.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Decisions({ r }: { r: MasterReport }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <h4 className="text-[15px] font-medium">What the engine did</h4>
      <p className="mt-1 text-[13px] text-mute">Each stage runs only when the analysis says your song needs it.</p>
      <ul className="mt-4 divide-y divide-line">
        {r.decisions.map((d) => (
          <li key={d.stage} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wider ${d.applied ? 'bg-glow/15 text-glow-soft' : 'bg-white/5 text-mute'}`}>{d.applied ? 'Applied' : 'Skipped'}</span>
              <span className="text-[15px]">{d.stage}</span>
              <span className="num ml-auto text-[13px] text-mute">{d.amount}</span>
            </div>
            <p className="mt-1 text-[13px] text-mute">{d.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Verdict({ r }: { r: MasterReport }) {
  if (!r.streamingReady) {
    return (
      <div className="rounded-2xl border border-bad/30 bg-bad/10 p-5 text-[15px]">
        <div className="font-medium text-bad">Verification found a problem</div>
        <p className="mt-1 text-mute">One or more output checks failed — see the details below. Try again, or choose another genre profile.</p>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-4 rounded-2xl border-2 border-good/35 bg-good/[0.10] p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-good/25 text-good">
        <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
      </div>
      <div>
        <h2 className="text-[18px] font-medium tracking-tight">Your song is ready for streaming</h2>
        <p className="mt-1 text-[15px] text-[#B4B4B4]">
          Mastered to {r.after.lufs.toFixed(1)} LUFS-I with peaks safely under −1 dBTP. It will play cleanly on Spotify, Apple Music, YouTube and every other platform.
        </p>
      </div>
    </div>
  )
}
