'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import PDFAnnotator from '@/components/pdf/PDFAnnotator'
import { getDocumentByCollabToken, getPdfUrl } from '@/lib/pdf-db'
import type { Document, PageAnnotations } from '@/types/pdf'

export default function CollabClient({ token }: { token: string }) {
  const [doc, setDoc] = useState<Document | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [initialAnnotations, setInitialAnnotations] = useState<Map<number, PageAnnotations> | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    getDocumentByCollabToken(token).then(result => {
      if (!result) {
        setNotFound(true)
      } else {
        setDoc(result.document)
        setPdfUrl(getPdfUrl(result.document.pdf_path))
        setInitialAnnotations(result.annotations)
      }
      setIsLoading(false)
    })
  }, [token])

  // Save via API route (service-role key validates the collab token server-side)
  const collabSave = useCallback(async (documentId: string, pageNumber: number, annotations: PageAnnotations) => {
    const res = await fetch('/api/pdf/collab/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, documentId, pageNumber, annotations }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error ?? '保存に失敗しました')
    }
  }, [token])

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-lg">読み込み中...</div>
      </div>
    )
  }

  if (notFound || !doc || !pdfUrl || initialAnnotations === undefined) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-5xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-gray-700 mb-2">リンクが無効です</h1>
          <p className="text-gray-400 text-sm mb-6">共同編集リンクが削除されたか、無効です</p>
          <Link href="/pdf" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm">
            ホームへ戻る
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shadow-sm">
        <Link href="/pdf" className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors whitespace-nowrap">
          📝 PDF Note
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="font-semibold text-gray-800 truncate flex-1 text-sm">{doc.title}</h1>
        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full font-medium whitespace-nowrap">
          🤝 共同編集
        </span>
      </header>

      {/* Full editor */}
      <div className="flex-1 overflow-hidden">
        <PDFAnnotator
          pdfUrl={pdfUrl}
          documentId={doc.id}
          initialAnnotations={initialAnnotations}
          saveFn={collabSave}
        />
      </div>
    </div>
  )
}
