/** WAV (RIFF) decode/encode with bit-depth preservation. */
export interface Decoded { channels: Float32Array[]; sampleRate: number; bitDepth: number; float: boolean }

export function decodeWav(buf: ArrayBuffer): Decoded {
  const v = new DataView(buf)
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a valid WAV file.')
  let o = 12, fmt = 0, nch = 0, sr = 0, bits = 0, dataOff = -1, dataLen = 0
  while (o + 8 <= buf.byteLength) {
    const id = tag(o), len = v.getUint32(o + 4, true)
    if (id === 'fmt ') {
      fmt = v.getUint16(o + 8, true); nch = v.getUint16(o + 10, true); sr = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true)
      if (fmt === 0xfffe) fmt = v.getUint16(o + 32, true)
    } else if (id === 'data') {
      dataOff = o + 8; dataLen = Math.min(len, buf.byteLength - dataOff); break
    }
    o += 8 + len + (len & 1)
  }
  if (dataOff < 0 || !nch || !sr) throw new Error('WAV file is missing format or audio data.')
  if (fmt !== 1 && fmt !== 3) throw new Error('Unsupported WAV encoding (only PCM and IEEE float are supported).')
  if (nch > 2) throw new Error('Only mono and stereo files are supported.')
  const bps = bits / 8, frames = Math.floor(dataLen / (bps * nch))
  const ch = Array.from({ length: nch }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const p = dataOff + (i * nch + c) * bps
      let s: number
      if (fmt === 3) s = bits === 64 ? v.getFloat64(p, true) : v.getFloat32(p, true)
      else if (bits === 16) s = v.getInt16(p, true) / 32768
      else if (bits === 24) s = ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16))) / 8388608
      else if (bits === 32) s = v.getInt32(p, true) / 2147483648
      else if (bits === 8) s = (v.getUint8(p) - 128) / 128
      else throw new Error(`Unsupported bit depth: ${bits}`)
      ch[c][i] = s
    }
  }
  return { channels: ch, sampleRate: sr, bitDepth: bits, float: fmt === 3 }
}

/** Encode to WAV. 16-bit output is TPDF-dithered; 24-bit integer; 32 = IEEE float. */
export function encodeWav(ch: Float32Array[], sr: number, bits: 16 | 24 | 32): ArrayBuffer {
  const nch = ch.length, frames = ch[0].length, bps = bits / 8
  const dataLen = frames * nch * bps
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, nch, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * nch * bps, true); v.setUint16(32, nch * bps, true); v.setUint16(34, bits, true)
  w(36, 'data'); v.setUint32(40, dataLen, true)
  let p = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, ch[c][i]))
      if (bits === 32) v.setFloat32(p, s, true)
      else if (bits === 16) {
        const d = (Math.random() - Math.random())
        v.setInt16(p, Math.max(-32768, Math.min(32767, Math.round(s * 32767 + d))), true)
      } else {
        const x = Math.max(-8388608, Math.min(8388607, Math.round(s * 8388607)))
        v.setUint8(p, x & 255); v.setUint8(p + 1, (x >> 8) & 255); v.setUint8(p + 2, (x >> 16) & 255)
      }
      p += bps
    }
  }
  return buf
}
