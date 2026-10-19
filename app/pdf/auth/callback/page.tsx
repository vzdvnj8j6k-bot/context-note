'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function PdfAuthCallback() {
  const router = useRouter()
  const [status, setStatus] = useState('処理中...')

  useEffect(() => {
    const fullUrl = window.location.href
    const search = window.location.search
    const hash = window.location.hash
    const code = new URLSearchParams(search).get('code')
    const error = new URLSearchParams(search).get('error')
    const errorDesc = new URLSearchParams(search).get('error_description')
    const hashParams = new URLSearchParams(hash.replace('#', ''))
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')

    console.log('[PDF Callback] URL:', fullUrl)
    console.log('[PDF Callback] search:', search)
    console.log('[PDF Callback] hash:', hash)
    console.log('[PDF Callback] code:', code)
    console.log('[PDF Callback] error:', error, errorDesc)
    console.log('[PDF Callback] access_token in hash:', !!accessToken)

    if (error) {
      console.error('[PDF Callback] OAuth error:', error, errorDesc)
      setStatus(`エラー: ${error}`)
      setTimeout(() => router.replace('/pdf'), 3000)
      return
    }

    if (code) {
      setStatus('コード交換中...')
      supabase.auth.exchangeCodeForSession(code)
        .then(({ data, error: err }) => {
          console.log('[PDF Callback] exchangeCodeForSession:', { session: data.session?.user?.email, error: err })
          if (err) setStatus(`交換エラー: ${err.message}`)
          router.replace('/pdf')
        })
        .catch(err => {
          console.error('[PDF Callback] catch error:', err)
          setStatus(`例外: ${err.message}`)
          setTimeout(() => router.replace('/pdf'), 3000)
        })
    } else if (accessToken && refreshToken) {
      setStatus('トークン設定中...')
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ data, error: err }) => {
          console.log('[PDF Callback] setSession:', { session: data.session?.user?.email, error: err })
          router.replace('/pdf')
        })
        .catch(err => {
          console.error('[PDF Callback] setSession error:', err)
          router.replace('/pdf')
        })
    } else {
      console.warn('[PDF Callback] No code or token found, redirecting to /pdf')
      setStatus('トークンなし、リダイレクト中...')
      setTimeout(() => router.replace('/pdf'), 1000)
    }
  }, [router])

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
      <p style={{ color: '#888' }}>{status}</p>
    </div>
  )
}
