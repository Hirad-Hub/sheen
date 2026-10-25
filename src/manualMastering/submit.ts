const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
const STORAGE_BUCKET = 'mastering-uploads'

function uploadPrivateAudio(url: string, key: string, accessToken: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('apikey', key)
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
    xhr.setRequestHeader('Content-Type', file.name.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav')
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)) }
    xhr.onerror = () => reject(new Error('The audio upload failed. Check your connection and try again.'))
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Supabase could not store this audio file. Check the project setup and try again.'))
    xhr.send(file)
  })
}

export async function submitMasteringRequest(file: File, email: string, session: { userId: string; accessToken: string }, onProgress: (pct: number) => void): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    throw new Error('The request form is not connected to Supabase yet. Configure the Supabase project URL and publishable key first.')
  }
  const baseUrl = SUPABASE_URL.replace(/\/$/, '')
  let safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase()
  if (!/\.(wav|wave|mp3)$/.test(safeFileName)) safeFileName += file.type === 'audio/mpeg' || file.type === 'audio/mp3' ? '.mp3' : '.wav'
  const path = `${session.userId}/${crypto.randomUUID()}/${safeFileName}`
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  await uploadPrivateAudio(`${baseUrl}/storage/v1/object/${STORAGE_BUCKET}/${encodedPath}`, SUPABASE_PUBLIC_KEY, session.accessToken, file, onProgress)

  const response = await fetch(`${baseUrl}/rest/v1/manual_mastering_requests`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: session.userId, email: email.trim(), file_name: file.name, file_path: path, status: 'new' }),
  })
  const result = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) throw new Error(result?.error || 'We could not submit your request. Please try again.')
}
