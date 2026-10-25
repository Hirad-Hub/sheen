import { useEffect, useState, type ReactNode } from 'react'
import Player from './Player'
import { loadSharedResult, publicAudioUrl, type SharedResult } from '../share/results'

export default function SharedResultPage({ slug }: { slug: string }) {
  const [result, setResult] = useState<SharedResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void loadSharedResult(slug).then(async (row) => {
      if (!row) throw new Error('This share link was not found. It may have been removed.')
      if (active) setResult(row)
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Could not load this shared result.') })
    return () => { active = false }
  }, [slug])

  if (error) return <Shell><div className="rounded-2xl border border-line bg-panel p-6 text-center"><h1 className="text-2xl font-semibold">Link unavailable</h1><p className="mt-3 text-[15px] text-mute">{error}</p><a href="/" className="mt-6 inline-flex rounded-full border border-line px-5 py-3 text-[14px] hover:border-white/25">Open Sheen</a></div></Shell>
  if (!result) return <Shell><div className="rounded-2xl border border-line bg-panel p-6 text-center"><div className="mx-auto size-6 animate-spin rounded-full border-2 border-white/15 border-t-glow"/><p className="mt-4 text-[15px] text-mute">Loading shared audio…</p></div></Shell>

  return <Shell>
    <section className="rounded-3xl border border-line bg-panel/70 p-5 sm:p-8">
      <p className="text-[13px] font-medium uppercase tracking-[.14em] text-glow-soft">Shared Sheen master</p>
      <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight sm:text-4xl">{result.title}</h1>
      <p className="mt-2 text-[15px] text-mute">Listen to the original and mastered versions below.</p>
      <div className="mt-6">
        <Player original={publicAudioUrl(result.original_path)} mastered={publicAudioUrl(result.mastered_path)} peaksBefore={Float32Array.from(result.peaks_before)} peaksAfter={Float32Array.from(result.peaks_after)} onStartOver={() => { window.location.href = '/' }}>
          <div className="mt-5 flex flex-wrap justify-center gap-3 border-t border-line pt-5">
            <a href={`${publicAudioUrl(result.original_path)}?download=${encodeURIComponent(result.original_file_name)}`} className="rounded-full border border-line px-5 py-3 text-[14px] transition hover:border-white/25">Download original</a>
            <a href={`${publicAudioUrl(result.mastered_path)}?download=${encodeURIComponent(result.mastered_file_name)}`} className="rounded-full bg-glow px-5 py-3 text-[14px] font-medium text-ink transition hover:bg-[#e65f0c]">Download mastered</a>
          </div>
        </Player>
      </div>
      <p className="mt-5 text-center text-[12px] leading-5 text-mute">Anyone with this link can access these audio files. Shared audio is hosted in Sheen’s configured storage.</p>
    </section>
  </Shell>
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-ink text-white"><header className="mx-auto flex max-w-5xl items-center px-6 py-6"><a href="/" className="flex items-center gap-2.5"><span className="flex h-6 items-end gap-[3px]">{[10, 18, 24, 14, 20].map((height) => <span key={height} className="w-[3px] rounded-full bg-glow" style={{ height }} />)}</span><span className="text-[19px] font-semibold tracking-tight">Sheen</span></a><span className="ml-3 hidden text-[15px] text-mute sm:inline">Shared mastering result</span></header><main className="mx-auto max-w-3xl px-6 pb-12 pt-4">{children}</main></div>
}
