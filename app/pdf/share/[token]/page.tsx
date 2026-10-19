import { Suspense } from 'react'
import ShareClient from './share-client'

export default function SharePage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-lg">読み込み中...</div>
      </div>
    }>
      <ShareClient />
    </Suspense>
  )
}
