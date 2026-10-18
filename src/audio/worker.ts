/// <reference lib="webworker" />
/** DSP worker: decoding (WAV), mastering, encoding and measurement off the UI thread. */
import { analyze } from './analysis'
import { ENGINE, type GenreId } from './config'
import { master } from './master'
import { encodeMp3 } from './mp3'
import { decodeWav, encodeWav } from './wav'

export type WorkerRequest =
  | { id: number; type: 'master'; kind: 'wav'; buffer: ArrayBuffer; genre: GenreId; bitrate: number }
  | { id: number; type: 'master'; kind: 'mp3'; channels: Float32Array[]; sampleRate: number; genre: GenreId; bitrate: number }
  | { id: number; type: 'encode'; wav: ArrayBuffer; bitrate: number; trimDb: number }
  | { id: number; type: 'measure'; channels: Float32Array[]; sampleRate: number }

function peaks(ch: Float32Array[], bins = 1400): Float32Array {
  const out = new Float32Array(bins)
  const n = ch[0].length, step = n / bins
  for (let b = 0; b < bins; b++) {
    let m = 0
    const e = Math.min(n, Math.floor((b + 1) * step))
    for (const c of ch) for (let i = Math.floor(b * step); i < e; i++) { const a = Math.abs(c[i]); if (a > m) m = a }
    out[b] = m
  }
  return out
}

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  try {
    if (req.type === 'master') {
      let ch: Float32Array[], fs: number, bits: 16 | 24 | 32 = 24
      if (req.kind === 'wav') {
        post({ id: req.id, type: 'progress', stage: 'Reading WAV', pct: 2 })
        const d = decodeWav(req.buffer)
        ch = d.channels; fs = d.sampleRate
        bits = ENGINE.wavOutput === '24' ? 24 : d.float ? 32 : d.bitDepth <= 16 ? 16 : 24
      } else {
        ch = req.channels; fs = req.sampleRate; bits = 32
      }
      if (ch[0].length / fs > ENGINE.maxDurationSec) throw new Error(`Tracks longer than ${ENGINE.maxDurationSec / 60} minutes are not supported.`)
      const before = peaks(ch)
      const { out, report } = master(ch, fs, req.genre, (stage, pct) => post({ id: req.id, type: 'progress', stage, pct }))
      post({ id: req.id, type: 'progress', stage: 'Rendering files', pct: 96 })
      const wav = encodeWav(out, fs, bits)
      const mp3 = encodeMp3(out, fs, req.bitrate)
      const after = peaks(out)
      post({ id: req.id, type: 'done', report, wav, wavBits: bits, mp3, sampleRate: fs, before, after }, [wav, mp3.buffer as ArrayBuffer])
    } else if (req.type === 'encode') {
      const d = decodeWav(req.wav)
      const mp3 = encodeMp3(d.channels, d.sampleRate, req.bitrate, req.trimDb)
      post({ id: req.id, type: 'encoded', mp3 }, [mp3.buffer as ArrayBuffer])
    } else if (req.type === 'measure') {
      post({ id: req.id, type: 'measured', metrics: analyze(req.channels, req.sampleRate) })
    }
  } catch (e) {
    post({ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
