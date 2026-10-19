'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function PdfAuthCallback() {
  const router = useRouter()
  const [info, setInfo] = useState<string[]>([])

  useEffect(() => {
    const search = window.location.search
    const hash = window.location.hash
    const code = new URLSearchParams(search).get('code')
    const error = new URLSearchParams(search).get('error')
    const errorDesc = new URLSearchParams(search).get('error_description')
    const hashParams = new URLSearchParams(hash.replace('#', ''))
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')

    const lines: string[] = [
      `search: ${search || '(空)'}`,
      `hash: ${hash ? hash.slice(0, 60) + '...' : '(空)'}`,
      `code: ${code ? 'あり' : 'なし'}`,
      `error: ${error || 'なし'}`,
      `access_token(hash): ${accessToken ? 'あり' : 'なし'}`,
    ]
    setInfo(lines)

    const finish = () => {
      try { localStorage.setItem('pdf-auth-complete', Date.now().toString()) } catch {}
      if (window.opener) {
        window.close()
      } else {
        router.replace('/pdf')
      }
    }

    if (error) {
      setInfo(prev => [...prev, `→ OAuthエラー: ${error}: ${errorDesc}`])
      setTimeout(finish, 5000)
      return
    }

    if (code) {
      setInfo(prev => [...prev, '→ コード交換中...'])
      supabase.auth.exchangeCodeForSession(code)
        .then(({ data, error: err }) => {
          if (err) {
            setInfo(prev => [...prev, `→ 交換失敗: ${err.message}`])
            setTimeout(finish, 5000)
          } else {
            setInfo(prev => [...prev, `→ 成功: ${data.session?.user?.email}`])
            setTimeout(finish, 1000)
          }
        })
        .catch(err => {
          setInfo(prev => [...prev, `→ 例外: ${String(err)}`])
          setTimeout(finish, 5000)
        })
    } else if (accessToken && refreshToken) {
      setInfo(prev => [...prev, '→ トークン設定中...'])
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error: err }) => {
          if (err) setInfo(prev => [...prev, `→ setSession失敗: ${err.message}`])
          else setInfo(prev => [...prev, '→ setSession成功'])
          setTimeout(finish, err ? 5000 : 1000)
        })
    } else {
      setInfo(prev => [...prev, '→ コードもトークンもなし。リダイレクト中...'])
      setTimeout(finish, 3000)
    }
  }, [router])

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ maxWidth: 500, width: '100%' }}>
        <p style={{ color: '#888', marginBottom: 12 }}>ログイン処理中...</p>
        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 12, fontFamily: 'monospace', fontSize: 12 }}>
          {info.map((line, i) => (
            <div key={i} style={{ color: line.startsWith('→') ? '#c00' : '#333', marginBottom: 4 }}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
