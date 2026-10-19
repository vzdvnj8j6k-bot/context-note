'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

export default function PdfAuthCallback() {
  const router = useRouter()

  useEffect(() => {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { flowType: 'implicit' } }
    )

    // implicit flow: access_token is in URL hash
    // pkce flow: code is in search params
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''))
    const searchParams = new URLSearchParams(window.location.search)
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')
    const code = searchParams.get('code')

    if (accessToken && refreshToken) {
      client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(() => router.replace('/pdf'))
    } else if (code) {
      client.auth.exchangeCodeForSession(code)
        .then(() => router.replace('/pdf'))
    } else {
      router.replace('/pdf')
    }
  }, [router])

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#888' }}>ログイン中...</p>
    </div>
  )
}
