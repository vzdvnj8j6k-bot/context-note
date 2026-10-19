'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PdfAuthCallback() {
  const router = useRouter()

  useEffect(() => {
    // For implicit flow: token is in URL hash, supabase client auto-detects it.
    // For PKCE flow: exchange the code.
    const params = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''))
    const code = params.get('code')
    const accessToken = hashParams.get('access_token')

    if (accessToken || code) {
      // Give the supabase client a moment to process the hash/code
      setTimeout(() => router.replace('/pdf'), 500)
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
