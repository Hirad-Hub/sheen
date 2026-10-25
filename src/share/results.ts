import { safeName } from '../audio/exportZip'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined
const SHARE_BASE_URL = (import.meta.env.VITE_SHARE_BASE_URL as string | undefined)?.replace(/\/$/, '')
const BUCKET = 'share-results'
export const FREE_FILE_LIMIT = 50 * 1024 * 1024

export type SharedResult = {
  slug: string
  title: string
  original_file_name: string
  mastered_file_name: string
  original_path: string
  mastered_path: string
  peaks_before: number[]
  peaks_after: number[]
  created_at: string
}

function config() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Sharing is not connected. Configure the Supabase URL and publishable key first.')
  }
  return { url: SUPABASE_URL, key: SUPABASE_KEY }
}

function makeSlug(fileName: string) {
  const stem = safeName(fileName.replace(/\.[^.]+$/, ''))
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 38) || 'my-song'
  return `${stem}-${crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`
}

function publicSiteUrl() {
  const base = SHARE_BASE_URL || window.location.origin
  const hostname = new URL(base).hostname.replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    throw new Error('This site is only running locally. Deploy it to a public domain before creating a link others can open.')
  }
  return base
}

async function upload(url: string, key: string, path: string, file: Blob, contentType: string) {
  const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'false' },
    body: file,
  })
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(result?.message || 'Supabase could not store the audio. Check the share bucket setup and storage limits.')
  }
}

export function publicAudioUrl(path: string) {
  const { url } = config()
  return `${url}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export async function createSharedResult(input: {
  original: File
  mastered: Blob
  peaksBefore: Float32Array
  peaksAfter: Float32Array
}): Promise<{ slug: string; title: string; url: string }> {
  const { url, key } = config()
  if (input.original.size > FREE_FILE_LIMIT || input.mastered.size > FREE_FILE_LIMIT) {
    throw new Error('Each shared audio file must be 50 MB or less on Supabase Free. Upgrade storage to share larger tracks.')
  }
  const siteUrl = publicSiteUrl()
  const slug = makeSlug(input.original.name)
  const originalName = safeName(input.original.name)
  const masteredName = `${safeName(input.original.name.replace(/\.[^.]+$/, ''))} (Mastered).mp3`
  const originalPath = `${slug}/original.${input.original.name.toLowerCase().endsWith('.mp3') ? 'mp3' : 'wav'}`
  const masteredPath = `${slug}/mastered.mp3`
  const title = slug.replace(/-[a-z0-9]{6}$/, '').replace(/-/g, ' ')

  await Promise.all([
    upload(url, key, originalPath, input.original, input.original.type || (originalPath.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav')),
    upload(url, key, masteredPath, input.mastered, 'audio/mpeg'),
  ])

  const response = await fetch(`${url}/rest/v1/shared_results`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      slug, title, original_file_name: originalName, mastered_file_name: masteredName,
      original_path: originalPath, mastered_path: masteredPath,
      peaks_before: Array.from(input.peaksBefore), peaks_after: Array.from(input.peaksAfter),
    }),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(result?.message || 'Audio uploaded, but the share record could not be saved. Check the database setup and try again.')
  }

  const shareUrl = new URL(siteUrl)
  shareUrl.search = new URLSearchParams({ share: slug }).toString()
  return { slug, title, url: shareUrl.toString() }
}

export async function loadSharedResult(slug: string): Promise<SharedResult | null> {
  const { url, key } = config()
  if (!/^[a-z0-9][a-z0-9-]{0,69}-[a-f0-9]{6}$/.test(slug)) return null
  const query = new URLSearchParams({ select: '*', slug: `eq.${slug}`, limit: '1' })
  const response = await fetch(`${url}/rest/v1/shared_results?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!response.ok) throw new Error('Could not load this shared result. It may have been removed or the share setup is incomplete.')
  const rows = await response.json() as SharedResult[]
  return rows[0] ?? null
}
