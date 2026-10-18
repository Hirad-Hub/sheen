/** In-place iterative radix-2 complex FFT. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti
        re[a] += tr; im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr; cr = nr
      }
    }
  }
}

/** Averaged power spectrum of the mono sum (Hann window). */
export function averageSpectrum(ch: Float32Array[], size = 8192, maxFrames = 240): Float64Array {
  const n = ch[0].length
  const frames = Math.max(1, Math.floor(n / size))
  const stride = Math.max(1, Math.floor(frames / maxFrames))
  const acc = new Float64Array(size / 2)
  const re = new Float64Array(size), im = new Float64Array(size)
  const win = new Float64Array(size)
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
  let count = 0
  for (let f = 0; f < frames; f += stride) {
    const o = f * size
    if (o + size > n) break
    for (let i = 0; i < size; i++) {
      let s = 0
      for (const c of ch) s += c[o + i]
      re[i] = (s / ch.length) * win[i]
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < size / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k]
    count++
  }
  if (count) for (let k = 0; k < acc.length; k++) acc[k] /= count
  return acc
}
