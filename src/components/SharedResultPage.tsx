import { useEffect, useState, type ReactNode } from 'react'
import { MP3_BITRATES } from '../audio/config'
import { reencodeSharedMp3 } from '../audio/client'
import { downloadBlob } from '../audio/exportZip'
import { saveMasteringDraft } from '../manualMastering/drafts'
import Player from './Player'
import { loadSharedResult, publicAudioUrl, type SharedResult } from '../share/results'

export default function SharedResultPage({ slug }: { slug: string }) {
  const [result, setResult] = useState<SharedResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bitrate, setBitrate] = useState<number>(320)
  const [downloading, setDownloading] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

  const downloadMaster = async () => {
    setDownloading(true); setActionError(null)
    try {
      const response = await fetch(publicAudioUrl(result.mastered_path))
      if (!response.ok) throw new Error('Could not load the mastered audio for download.')
      const source = await response.blob()
      const file = bitrate === 320 ? source : await reencodeSharedMp3(source, bitrate)
      const baseName = result.mastered_file_name.replace(/\.mp3$/i, '')
      downloadBlob(file, `${baseName} ${bitrate}kbps.mp3`)
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not prepare the download.') }
    finally { setDownloading(false) }
  }

  const upgradeToHumanMastering = async () => {
    setUpgrading(true); setActionError(null)
    try {
      const response = await fetch(publicAudioUrl(result.original_path))
      if (!response.ok) throw new Error('Could not load the original audio for your request.')
      const audio = await response.blob()
      const type = audio.type || (result.original_file_name.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav')
      const file = new File([audio], result.original_file_name, { type })
      const draftId = crypto.randomUUID()
      await saveMasteringDraft(draftId, file)
      const next = new URL('/', window.location.origin)
      next.search = new URLSearchParams({ manualMastering: '1', draft: draftId }).toString()
      window.location.assign(next.toString())
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not prepare a human mastering request.') }
    finally { setUpgrading(false) }
  }

  return <Shell>
    <section className="rounded-3xl border border-line bg-panel/70 p-5 sm:p-8">
      <p className="text-[13px] font-medium uppercase tracking-[.14em] text-glow-soft">Mastered by Sheen</p>
      <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight sm:text-4xl">{result.title}</h1>
      <p className="mt-2 text-[15px] text-mute">Listen to the original and mastered versions below.</p>
      <div className="mt-6">
        <Player original={publicAudioUrl(result.original_path)} mastered={publicAudioUrl(result.mastered_path)} peaksBefore={Float32Array.from(result.peaks_before)} peaksAfter={Float32Array.from(result.peaks_after)} onStartOver={() => { window.location.href = '/' }} headerAction={<span aria-hidden="true" />}>
          <div className="border-t border-line pt-5">
            <div className="mt-4 text-center">
              <div className="flex flex-wrap justify-center gap-2">
                {MP3_BITRATES.map((b) => (
                  <label key={b} className={`flex h-8 cursor-pointer items-center rounded-full border px-4 text-[14px] transition ${bitrate === b ? 'border-glow bg-glow/10 text-white' : 'border-line text-mute hover:border-white/20 hover:text-white'}`}>
                    <input type="radio" name="shared-mp3-bitrate" className="sr-only" checked={bitrate === b} onChange={() => setBitrate(b)} />
                    <span className="num">{b}</span> kbps{b === 320 ? ' · default' : ''}
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3 pb-2">
              <button disabled={downloading} onClick={() => void downloadMaster()} className="rounded-full bg-glow px-8 py-4 text-base font-medium text-white transition hover:bg-[#e65f0c] disabled:cursor-wait disabled:opacity-60">
                {downloading ? 'Preparing download…' : `Download MP3 · ${bitrate} kbps`}
              </button>
              <button disabled={upgrading} onClick={() => void upgradeToHumanMastering()} className="rounded-full bg-white px-5 py-4 text-base font-medium text-black transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-60 sm:px-8">
                {upgrading ? 'Preparing…' : 'Upgrade to Human Mastering'}
              </button>
            </div>
            {actionError && <p role="alert" className="mt-4 text-center text-[14px] text-bad">{actionError}</p>}
          </div>
        </Player>
      </div>
    </section>
  </Shell>
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-ink text-white"><header className="mx-auto flex max-w-5xl items-center px-6 py-6"><a href="/" className="flex items-center gap-2.5"><span className="flex h-6 items-end gap-[3px]">{[10, 18, 24, 14, 20].map((height) => <span key={height} className="w-[3px] rounded-full bg-glow" style={{ height }} />)}</span><span className="text-[19px] font-semibold tracking-tight">Sheen</span></a><span className="ml-3 hidden text-[15px] text-mute sm:inline">Shared mastering result</span><a href="/" className="ml-auto rounded-full border border-line px-4 py-2 text-[14px] text-mute transition hover:border-white/25 hover:text-white">Start over</a></header><main className="mx-auto max-w-3xl px-6 pb-12 pt-4">{children}</main></div>
}
