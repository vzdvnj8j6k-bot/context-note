import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ContextNote',
  description: 'コーネル式セマンティックブロック講義ノートアプリ',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full flex flex-col">{children}</body>
    </html>
  )
}
