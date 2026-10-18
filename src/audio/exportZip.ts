/** Batch ZIP export, compatible with macOS Archive Utility and Windows Explorer. */
import { zipSync } from 'fflate'

/** Strip characters that are illegal on Windows/macOS and normalise Unicode (NFC). */
export function safeName(name: string) {
  const s = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim()
  return s.slice(0, 120) || 'track'
}

export async function buildZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {}
  const used = new Set<string>()
  for (const f of files) {
    let name = `Mastered/${f.name}`, i = 2
    while (used.has(name.toLowerCase())) name = `Mastered/${f.name.replace(/(\.[^.]+)$/, ` (${i++})$1`)}`
    used.add(name.toLowerCase())
    // audio is already compressed or incompressible; "store" keeps it fast and universally readable
    entries[name] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }]
  }
  const data = zipSync(entries, { mtime: new Date() })
  return new Blob([data as BlobPart], { type: 'application/zip' })
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
