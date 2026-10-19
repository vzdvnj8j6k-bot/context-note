import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Classnotes',
  description: 'コーネル式ノートアプリ — キュー・ノート・まとめで授業を構造化',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full flex flex-col">{children}</body>
    </html>
  )
}
