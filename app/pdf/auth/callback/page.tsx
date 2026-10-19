'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function PdfAuthCallback() {
  const router = useRouter()
  const [status, setStatus] = useState('ログイン中...')

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''))
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')
    const error = new URLSearchParams(window.location.search).get('error')

    const finish = () => {
      // Signal the opener (popup parent) that auth is complete
      try { localStorage.setItem('pdf-auth-complete', Date.now().toString()) } catch {}
      if (window.opener) {
        window.close()
      } else {
        router.replace('/pdf')
      }
    }

    if (error) {
      setStatus(`エラー: ${error}`)
      setTimeout(finish, 2000)
      return
    }

    if (code) {
      supabase.auth.exchangeCodeForSession(code)
        .then(() => finish())
        .catch(() => finish())
    } else if (accessToken && refreshToken) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(() => finish())
        .catch(() => finish())
    } else {
      finish()
    }
  }, [router])

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#888' }}>{status}</p>
    </div>
  )
}
