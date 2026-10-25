/** Main-thread API: file validation, MP3 decoding, worker orchestration and MP3 output verification. */
import type { Metrics } from './analysis'
import { ENGINE, GENRES, type GenreId } from './config'
import type { MasterReport } from './master'
import type { WorkerRequest } from './worker'
import { encodeWav } from './wav'

export interface Mp3Check { bitrate: number; truePeakDb: number; lufs: number; clipRuns: number; ok: boolean; trimDb: number }
export interface MasterResult {
  report: MasterReport
  sourceKind: 'wav' | 'mp3'
  sampleRate: number
  wavBits: number
  /** master WAV (deliverable for WAV sources; internal reference for MP3 sources) */
  wav: Blob
  mp3: Blob
  mp3Check: Mp3Check
  peaksBefore: Float32Array
  peaksAfter: Float32Array
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (s: string, p: number) => void }
let worker: Worker | null = null
const pending = new Map<number, Pending>()
let nextId = 1

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (ev) => {
    const m = ev.data, p = pending.get(m.id)
    if (!p) return
    if (m.type === 'progress') return p.onProgress?.(m.stage, m.pct)
    pending.delete(m.id)
    if (m.type === 'error') p.reject(new Error(m.message))
    else p.resolve(m)
  }
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The audio engine crashed (possibly out of memory).'))
    pending.clear()
    worker?.terminate(); worker = null
  }
  return worker
}

type Req = WorkerRequest extends infer U ? (U extends WorkerRequest ? Omit<U, 'id'> : never) : never
function call<T>(req: Req, transfer: Transferable[] = [], onProgress?: Pending['onProgress']): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    getWorker().postMessage({ ...req, id }, transfer)
  })
}

export function detectKind(file: File): 'wav' | 'mp3' | null {
  const n = file.name.toLowerCase()
  if (n.endsWith('.wav') || n.endsWith('.wave') || file.type.includes('wav')) return 'wav'
  if (n.endsWith('.mp3') || file.type === 'audio/mpeg' || file.type === 'audio/mp3') return 'mp3'
  return null
}

export function validateFile(file: File): string | null {
  if (!detectKind(file)) return 'Unsupported format — please upload a WAV or MP3 file.'
  if (file.size > ENGINE.maxFileBytes) return `File is larger than ${ENGINE.maxFileBytes / 1024 / 1024} MB.`
  if (file.size < 1024) return 'File is too small to contain audio.'
  return null
}

/** Reads the sample rate from the first MPEG audio frame header. */
function mp3SampleRate(buf: ArrayBuffer): number {
  const b = new Uint8Array(buf)
  let o = 0
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) o = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9])
  const end = Math.min(b.length - 4, o + 65536)
  for (; o < end; o++) {
    if (b[o] === 0xff && (b[o + 1] & 0xe0) === 0xe0) {
      const ver = (b[o + 1] >> 3) & 3, idx = (b[o + 2] >> 2) & 3
      if (idx === 3 || ver === 1) continue
      const base = [44100, 48000, 32000][idx]
      return ver === 3 ? base : ver === 2 ? base / 2 : base / 4
    }
  }
  return 44100
}

async function decodeMp3(buf: ArrayBuffer): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const sr = mp3SampleRate(buf)
  const ctx = new OfflineAudioContext(2, 1, sr)
  let ab: AudioBuffer
  try {
    ab = await ctx.decodeAudioData(buf)
  } catch {
    throw new Error('Could not decode this MP3 — the file may be corrupted.')
  }
  const channels = Array.from({ length: Math.min(2, ab.numberOfChannels) }, (_, i) => Float32Array.from(ab.getChannelData(i)))
  return { channels, sampleRate: ab.sampleRate }
}

/** Decode the encoded MP3 and verify it independently; re-encode once from the master with a trim if it overs. */
async function verifiedMp3(first: Uint8Array, wav: Blob, bitrate: number, ceiling: number): Promise<{ mp3: Uint8Array; check: Mp3Check }> {
  let mp3 = first, trimDb = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    const dec = await decodeMp3(mp3.slice().buffer)
    const { metrics } = await call<{ metrics: Metrics }>({ type: 'measure', channels: dec.channels, sampleRate: dec.sampleRate }, dec.channels.map((c) => c.buffer))
    const ok = metrics.truePeakDb <= ceiling + 0.01 && metrics.clipRuns === 0 && metrics.invalidSamples === 0
    if (ok || attempt === 2) return { mp3, check: { bitrate, truePeakDb: metrics.truePeakDb, lufs: metrics.lufs, clipRuns: metrics.clipRuns, ok, trimDb } }
    trimDb -= metrics.truePeakDb - ceiling + 0.1
    const r = await call<{ mp3: Uint8Array }>({ type: 'encode', wav: await wav.arrayBuffer(), bitrate, trimDb })
    mp3 = r.mp3
  }
  throw new Error('unreachable')
}

export async function masterFile(file: File, genre: GenreId, bitrate: number, onProgress: (stage: string, pct: number) => void): Promise<MasterResult> {
  const kind = detectKind(file)
  if (!kind) throw new Error('Unsupported format — please upload a WAV or MP3 file.')
  onProgress('Loading file', 1)
  const buf = await file.arrayBuffer()
  let res: any
  if (kind === 'wav') {
    res = await call({ type: 'master', kind, buffer: buf, genre, bitrate }, [buf], onProgress)
  } else {
    onProgress('Decoding MP3', 2)
    const d = await decodeMp3(buf)
    res = await call({ type: 'master', kind, channels: d.channels, sampleRate: d.sampleRate, genre, bitrate }, d.channels.map((c) => c.buffer), onProgress)
  }
  const wav = new Blob([res.wav], { type: 'audio/wav' })
  onProgress('Verifying MP3 output', 98)
  const { mp3, check } = await verifiedMp3(res.mp3, wav, bitrate, GENRES[genre].ceilingDbtp)
  return {
    report: res.report, sourceKind: kind, sampleRate: res.sampleRate, wavBits: res.wavBits, wav,
    mp3: new Blob([mp3 as BlobPart], { type: 'audio/mpeg' }), mp3Check: check, peaksBefore: res.before, peaksAfter: res.after,
  }
}

/** Re-encode the MP3 at a different bitrate from the stored master (single encode from the master). */
export async function reencode(r: MasterResult, bitrate: number): Promise<MasterResult> {
  const first = await call<{ mp3: Uint8Array }>({ type: 'encode', wav: await r.wav.arrayBuffer(), bitrate, trimDb: 0 })
  const { mp3, check } = await verifiedMp3(first.mp3, r.wav, bitrate, GENRES[r.report.genre].ceilingDbtp)
  return { ...r, mp3: new Blob([mp3 as BlobPart], { type: 'audio/mpeg' }), mp3Check: check }
}

/** Re-encode a shared MP3 for a requested download bitrate. */
export async function reencodeSharedMp3(file: Blob, bitrate: number): Promise<Blob> {
  const decoded = await decodeMp3(await file.arrayBuffer())
  const wav = encodeWav(decoded.channels, decoded.sampleRate, 32)
  const result = await call<{ mp3: Uint8Array }>({ type: 'encode', wav, bitrate, trimDb: 0 }, [wav])
  return new Blob([result.mp3 as BlobPart], { type: 'audio/mpeg' })
}
