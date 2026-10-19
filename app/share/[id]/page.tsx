'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Note, Block } from '@/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const BADGE: Partial<Record<string, string>> = {
  important: 'DEF', question: 'Q?', exam: '★', cause: '⇒', reaction: '～',
}

const TYPE_COLOR: Record<string, string> = {
  important: '#4f9cf9', question: '#c084fc', exam: '#fb923c',
  cause: '#34d399', reaction: '#f472b6', normal: 'rgba(255,255,255,.55)',
}

const CORNELL_QUESTIONS = [
  '定義・概念は何か？',
  'なぜ・どのように起きるのか？',
  '具体的な例は？',
  '他の概念・以前の内容との違いは？',
  '試験で問われそうな点は？',
]

export default function SharePage({ params }: { params: { id: string } }) {
  const [note, setNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    supabase
      .from('shares')
      .select('note_data')
      .eq('id', params.id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setNotFound(true) }
        else { setNote(data.note_data as Note) }
        setLoading(false)
      })
  }, [params.id])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d1117', color: 'rgba(255,255,255,.4)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
      読み込み中...
    </div>
  )

  if (notFound || !note) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d1117', color: 'rgba(255,255,255,.5)', fontFamily: 'IBM Plex Mono, monospace', gap: 12 }}>
      <div style={{ fontSize: 32 }}>🔍</div>
      <div>ノートが見つかりません</div>
      <div style={{ fontSize: 11 }}>リンクが無効か、削除された可能性があります</div>
    </div>
  )

  let cueAnswers: string[] = []
  try { cueAnswers = JSON.parse(note.cue) } catch {}
  if (!Array.isArray(cueAnswers)) cueAnswers = []

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: "'IBM Plex Mono', monospace" }}>
      {/* Header */}
      <div style={{ background: '#161b22', borderBottom: '1px solid rgba(255,255,255,.07)', padding: '14px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginBottom: 4 }}>共有ノート · 読み取り専用</span>
        </div>
        <div style={{ maxWidth: 900, margin: '6px auto 0', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#fff', fontFamily: 'inherit' }}>{note.subject || '(科目なし)'}</span>
          {note.session && <span style={{ fontSize: 13, color: 'rgba(255,255,255,.5)' }}>第{note.session}回</span>}
          <span style={{ fontSize: 15, color: '#c9d1d9' }}>{note.topic}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,.3)' }}>{note.date}</span>
        </div>
      </div>

      {/* Cornell layout */}
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 0, minHeight: 'calc(100vh - 100px)' }}>

        {/* Cue panel */}
        <div style={{ borderRight: '1px solid rgba(255,255,255,.06)', padding: '20px 16px' }}>
          <div style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.3)', marginBottom: 16 }}>キュー・問い</div>
          {CORNELL_QUESTIONS.map((q, i) => (
            <div key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < 4 ? '1px dotted rgba(255,255,255,.07)' : 'none' }}>
              <div style={{ fontSize: 10, color: '#4f9cf9', marginBottom: 6, display: 'flex', gap: 5 }}>
                <span style={{ opacity: 0.5 }}>{i + 1}.</span>
                <span style={{ color: 'rgba(255,255,255,.5)' }}>{q}</span>
              </div>
              {cueAnswers[i] ? (
                <div style={{ fontSize: 12, color: '#e6edf3', lineHeight: 1.7, padding: '5px 8px', background: 'rgba(79,156,249,.06)', borderRadius: 5, borderLeft: '2px solid rgba(79,156,249,.3)', whiteSpace: 'pre-wrap' }}>
                  {cueAnswers[i]}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.2)', fontStyle: 'italic' }}>（未記入）</div>
              )}
            </div>
          ))}
        </div>

        {/* Notes + summary */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, padding: '20px 20px 0' }}>
            <div style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.3)', marginBottom: 16 }}>ノート</div>
            {note.blocks.map((b: Block) => {
              const color = TYPE_COLOR[b.type] ?? TYPE_COLOR.normal
              const badge = BADGE[b.type]
              const indent = (b.level ?? 0) * 20
              return (
                <div key={b.id} style={{
                  marginLeft: indent,
                  padding: '5px 10px',
                  marginBottom: 4,
                  borderRadius: 5,
                  background: b.type !== 'normal' ? `${color}10` : 'transparent',
                  borderLeft: b.type !== 'normal' ? `3px solid ${color}` : '3px solid transparent',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                }}>
                  {badge && <span style={{ fontSize: 9, color, fontWeight: 700, marginTop: 3, flexShrink: 0, minWidth: 20 }}>{badge}</span>}
                  <span style={{ fontSize: 13, color: '#e6edf3', lineHeight: 1.7 }}>{b.content}</span>
                </div>
              )
            })}
          </div>

          {/* Summary */}
          {note.summary && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '14px 20px' }}>
              <div style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.3)', marginBottom: 8 }}>まとめ</div>
              <div style={{ fontSize: 13, color: '#c9d1d9', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{note.summary}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
