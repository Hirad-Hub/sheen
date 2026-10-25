const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_PUBLIC_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

type SupabaseError = { message?: string; msg?: string; error_description?: string; error?: string }

export type VerifiedEmailSession = {
  userId: string
  accessToken: string
}

function config() {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    throw new Error('Email verification is not connected yet. Configure the Supabase project URL and publishable key first.')
  }
  return { baseUrl: SUPABASE_URL.replace(/\/$/, ''), key: SUPABASE_PUBLIC_KEY }
}

async function request(path: string, body: Record<string, unknown>) {
  const { baseUrl, key } = config()
  const response = await fetch(`${baseUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null) as (SupabaseError & { access_token?: string; user?: { id?: string } }) | null
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || payload?.error_description || payload?.error || 'We could not verify your email. Please try again.')
  }
  return payload
}

export async function sendEmailOtp(email: string): Promise<void> {
  await request('otp', { email: email.trim(), create_user: true })
}

export async function verifyEmailOtp(email: string, token: string): Promise<VerifiedEmailSession> {
  const payload = await request('verify', { email: email.trim(), token: token.trim(), type: 'email' })
  if (!payload?.access_token || !payload.user?.id) {
    throw new Error('Supabase verified the code but did not return a user session. Please try again.')
  }
  return { accessToken: payload.access_token, userId: payload.user.id }
}
