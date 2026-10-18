/** RBJ cookbook biquads, processed in double precision (TDF-II). */
export interface Coefs { b0: number; b1: number; b2: number; a1: number; a2: number }

export function process(x: Float32Array, c: Coefs, out: Float32Array = x): Float32Array {
  let z1 = 0, z2 = 0
  const { b0, b1, b2, a1, a2 } = c
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    const y = b0 * v + z1
    z1 = b1 * v - a1 * y + z2
    z2 = b2 * v - a2 * y
    out[i] = y
  }
  return out
}

function norm(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coefs {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

export function highShelf(fs: number, f0: number, gainDb: number, q: number): Coefs {
  const A = Math.pow(10, gainDb / 40), w = (2 * Math.PI * f0) / fs
  const cw = Math.cos(w), al = Math.sin(w) / (2 * q), s = 2 * Math.sqrt(A) * al
  return norm(
    A * (A + 1 + (A - 1) * cw + s), -2 * A * (A - 1 + (A + 1) * cw), A * (A + 1 + (A - 1) * cw - s),
    A + 1 - (A - 1) * cw + s, 2 * (A - 1 - (A + 1) * cw), A + 1 - (A - 1) * cw - s,
  )
}

export function peaking(fs: number, f0: number, gainDb: number, q: number): Coefs {
  const A = Math.pow(10, gainDb / 40), w = (2 * Math.PI * f0) / fs
  const cw = Math.cos(w), al = Math.sin(w) / (2 * q)
  return norm(1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A)
}

/** Constant 0 dB peak-gain band-pass. */
export function bandpass(fs: number, f0: number, q: number): Coefs {
  const w = (2 * Math.PI * f0) / fs, cw = Math.cos(w), al = Math.sin(w) / (2 * q)
  return norm(al, 0, -al, 1 + al, -2 * cw, 1 - al)
}

export function lowpass(fs: number, f0: number, q = Math.SQRT1_2): Coefs {
  const w = (2 * Math.PI * f0) / fs, cw = Math.cos(w), al = Math.sin(w) / (2 * q)
  return norm((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + al, -2 * cw, 1 - al)
}

export function highpass(fs: number, f0: number, q = Math.SQRT1_2): Coefs {
  const w = (2 * Math.PI * f0) / fs, cw = Math.cos(w), al = Math.sin(w) / (2 * q)
  return norm((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al, -2 * cw, 1 - al)
}

/** 4th-order Linkwitz–Riley (two cascaded Butterworth sections); returns a new array. */
export function lr4(x: Float32Array, c: Coefs): Float32Array {
  const y = process(x, c, new Float32Array(x.length))
  return process(y, c)
}
