const DB_NAME = 'sheen-manual-mastering'
const STORE_NAME = 'drafts'

export type MasteringDraft = { id: string; file: File; createdAt: number }

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local draft storage.'))
  })
}

export async function saveMasteringDraft(id: string, file: File): Promise<void> {
  const db = await openDraftDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ id, file, createdAt: Date.now() } satisfies MasteringDraft)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('Could not save the track for the next page.'))
    })
  } finally { db.close() }
}

export async function getMasteringDraft(id: string): Promise<MasteringDraft | null> {
  const db = await openDraftDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
      request.onsuccess = () => resolve((request.result as MasteringDraft | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('Could not load the selected track.'))
    })
  } finally { db.close() }
}

export async function deleteMasteringDraft(id: string): Promise<void> {
  const db = await openDraftDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('Could not clear the local track draft.'))
    })
  } finally { db.close() }
}
