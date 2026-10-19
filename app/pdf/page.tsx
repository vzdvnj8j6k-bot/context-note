'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { deleteDocument, getDocuments, getLastSession, getSession, signOut, uploadDocument } from '@/lib/pdf-db'
import { supabase } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

const pdfAuthClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { flowType: 'implicit' } }
)
import { Document } from '@/types/pdf'
import type { Session } from '@supabase/supabase-js'
import Link from 'next/link'

export default function PdfHomePage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [documents, setDocuments] = useState<Document[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [lastSession, setLastSession] = useState<{ documentId: string; title: string; pageNumber: number; savedAt: string } | null>(null)
  const [resumeDismissed, setResumeDismissed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getSession().then(s => {
      setSession(s)
      if (s) getLastSession().then(ls => setLastSession(ls))
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s) getLastSession().then(ls => setLastSession(ls))
    })
    return () => subscription.unsubscribe()
  }, [])

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await getDocuments()
      setDocuments(docs)
    } catch (e) {
      console.error('Failed to load documents:', e)
    }
  }, [])

  useEffect(() => {
    if (session) loadDocuments()
  }, [session, loadDocuments])

  function handleGoogleLogin() {
    pdfAuthClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/pdf` },
    })
  }

  async function handleSignOut() {
    await signOut()
    setSession(null)
    setDocuments([])
  }

  async function handleFile(file: File) {
    if (!file.type.includes('pdf')) {
      setError('PDFファイルのみアップロードできます')
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('ファイルサイズは50MB以下にしてください')
      return
    }

    setError(null)
    setIsUploading(true)
    try {
      const doc = await uploadDocument(file, file.name.replace('.pdf', ''))
      router.push(`/pdf/editor/${doc.id}`)
    } catch (e) {
      console.error('Upload error:', e)
      setError('アップロードに失敗しました。Supabaseの設定を確認してください。')
    } finally {
      setIsUploading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function handleDelete(doc: Document) {
    if (!confirm(`「${doc.title}」を削除しますか？`)) return
    try {
      await deleteDocument(doc.id)
      setDocuments(prev => prev.filter(d => d.id !== doc.id))
    } catch (e) {
      console.error('Delete error:', e)
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  if (session === undefined) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-gray-400 text-lg">読み込み中...</div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-10 w-full max-w-sm text-center">
          <div className="text-5xl mb-4">📝</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">PDF Note</h1>
          <p className="text-gray-500 text-sm mb-4">PDFに自由に書き込み・共有・印刷</p>
          <Link href="/" className="block mb-6 text-sm text-blue-600 hover:underline">← ノートアプリへ戻る</Link>
          {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
          <button
            onClick={handleGoogleLogin}
            disabled={isSigningIn}
            className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-white border-2 border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-60 shadow-sm"
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {isSigningIn ? 'ログイン中...' : 'Googleでログイン'}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link href="/" className="text-sm text-blue-600 hover:underline">← ノートへ</Link>
              <h1 className="text-4xl font-bold text-gray-800">📝 PDF Note</h1>
            </div>
            <p className="text-gray-500 text-sm">PDFに自由に書き込み・共有・印刷</p>
          </div>
          <div className="flex items-center gap-3">
            {session.user.user_metadata?.avatar_url && (
              <img src={session.user.user_metadata.avatar_url} alt="" className="w-9 h-9 rounded-full border border-gray-200" />
            )}
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-700 truncate max-w-[160px]">{session.user.user_metadata?.full_name ?? session.user.email}</p>
              <p className="text-xs text-gray-400 truncate max-w-[160px]">{session.user.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
            >
              ログアウト
            </button>
          </div>
        </div>

        {lastSession && !resumeDismissed && (
          <div className="mb-6 flex items-center gap-4 bg-blue-600 text-white rounded-2xl px-5 py-4 shadow-md">
            <div className="text-2xl">📖</div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-blue-200 mb-0.5">前回の続き</p>
              <p className="font-semibold truncate">{lastSession.title}</p>
              <p className="text-xs text-blue-200">{lastSession.pageNumber}ページ目 · {new Date(lastSession.savedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            <button
              onClick={() => router.push(`/pdf/editor/${lastSession.documentId}?page=${lastSession.pageNumber}`)}
              className="px-4 py-2 bg-white text-blue-600 rounded-xl font-bold text-sm hover:bg-blue-50 transition-colors whitespace-nowrap flex-shrink-0"
            >
              続きから開く
            </button>
            <button
              onClick={() => setResumeDismissed(true)}
              className="text-blue-300 hover:text-white transition-colors text-lg flex-shrink-0"
              aria-label="閉じる"
            >
              ×
            </button>
          </div>
        )}

        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200 mb-8
            ${isDragging
              ? 'border-blue-500 bg-blue-50 scale-[1.01]'
              : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50'
            }
            ${isUploading ? 'pointer-events-none opacity-70' : ''}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          {isUploading ? (
            <div className="space-y-3">
              <div className="text-4xl animate-bounce">⏳</div>
              <p className="text-gray-600 font-medium">アップロード中...</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-5xl">📄</div>
              <p className="text-gray-700 font-semibold text-lg">PDFファイルをドラッグ＆ドロップ</p>
              <p className="text-gray-400 text-sm">または クリックしてファイルを選択</p>
              <p className="text-gray-300 text-xs">最大 50MB</p>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
            ⚠️ {error}
          </div>
        )}

        {documents.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-gray-700 mb-4">最近のファイル</h2>
            <div className="grid gap-3">
              {documents.map(doc => (
                <div
                  key={doc.id}
                  className="flex items-center gap-4 bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100"
                >
                  <div className="text-3xl">📄</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-800 truncate">{doc.title}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {doc.total_pages}ページ · {formatDate(doc.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/pdf/editor/${doc.id}`)}
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      開く
                    </button>
                    <button
                      onClick={() => handleDelete(doc)}
                      className="px-3 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {documents.length === 0 && !isUploading && (
          <p className="text-center text-gray-400 text-sm">
            まだファイルがありません。上のエリアにPDFをアップロードしてください。
          </p>
        )}
      </div>
    </main>
  )
}
