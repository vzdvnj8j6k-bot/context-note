'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Block, BlockType, Note } from '@/lib/types'
import { loadStore, saveStore, uid, todayStr } from '@/lib/store'

// ── Prefix → block type ────────────────────────────────────────────────────
const PREFIXES: Record<string, BlockType> = {
  '> ':  'important',
  '? ':  'question',
  '! ':  'exam',
  '=> ': 'cause',
  '- ':  'normal',
}
const BADGE: Partial<Record<BlockType, string>> = {
  important: 'DEF', question: 'Q?', exam: '★', cause: '⇒',
}
function detectType(text: string): BlockType {
  for (const [p, t] of Object.entries(PREFIXES)) {
    if (text.startsWith(p)) return t
  }
  return 'normal'
}

// ── Block editor ────────────────────────────────────────────────────────────
function BlockEditor({
  blocks, onUpdate, reviewMode, onFocusChange,
  tabNext, tabPrev,
}: {
  blocks: Block[]
  onUpdate: (blocks: Block[]) => void
  reviewMode: boolean
  onFocusChange?: (focused: boolean) => void
  tabNext?: () => void
  tabPrev?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep DOM in sync with blocks prop
  // We manage the DOM directly (contenteditable) and call onUpdate on changes.
  // To avoid cursor jumps, we only re-render when the blocks list structure changes
  // (added/removed blocks), not on every keystroke.

  function getBlockEls(): HTMLDivElement[] {
    if (!containerRef.current) return []
    return [...containerRef.current.querySelectorAll<HTMLDivElement>('.block-line')]
  }

  function readBlocks(): Block[] {
    return getBlockEls().map(el => ({
      id: el.dataset.id!,
      type: (el.dataset.type as BlockType) || 'normal',
      content: textOf(el),
    }))
  }

  function textOf(el: HTMLDivElement): string {
    let t = ''
    el.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) t += n.textContent })
    return t
  }

  function setTextOf(el: HTMLDivElement, text: string) {
    const children = [...el.childNodes].filter(n => n.nodeType !== Node.TEXT_NODE)
    // Remove old text nodes
    ;[...el.childNodes].forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove() })
    el.insertBefore(document.createTextNode(text), el.firstChild)
  }

  function updateType(el: HTMLDivElement) {
    const text = textOf(el)
    const type = detectType(text)
    el.dataset.type = type
    const badge = el.querySelector<HTMLSpanElement>('.block-badge')
    if (badge) badge.textContent = BADGE[type] ?? ''
  }

  function placeCaretEnd(el: HTMLElement) {
    el.focus()
    const sel = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  function createBlockEl(block: Block): HTMLDivElement {
    const div = document.createElement('div')
    div.className = 'block-line'
    div.contentEditable = 'true'
    div.spellcheck = true
    div.dataset.id = block.id
    div.dataset.type = block.type
    div.dataset.ph = '行を入力… (> 定義  ? 疑問  ! 試験  => 因果)'
    div.appendChild(document.createTextNode(block.content))

    const badge = document.createElement('span')
    badge.className = 'block-badge'
    badge.textContent = BADGE[block.type] ?? ''
    div.appendChild(badge)

    // mask layer (always present, shown via CSS class)
    const mask = document.createElement('div')
    mask.className = 'mask-cover'
    mask.textContent = 'クリックで表示'
    div.appendChild(mask)

    return div
  }

  // Initial render and block list sync
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const existing = getBlockEls()

    // Reconcile: add missing, remove extra
    if (existing.length === 0 || blocks.length === 0) {
      container.innerHTML = ''
      blocks.forEach(b => container.appendChild(createBlockEl(b)))
      if (blocks.length === 0) {
        const b: Block = { id: uid(), type: 'normal', content: '' }
        container.appendChild(createBlockEl(b))
      }
      return
    }

    // Simple reconcile: if IDs match, update content only if different
    const existingIds = existing.map(e => e.dataset.id)
    const blockIds = blocks.map(b => b.id)

    if (JSON.stringify(existingIds) !== JSON.stringify(blockIds)) {
      // Structure changed — full re-render
      const focused = container.querySelector<HTMLDivElement>(':focus')
      const focusedId = focused?.dataset.id
      container.innerHTML = ''
      blocks.forEach(b => container.appendChild(createBlockEl(b)))
      if (focusedId) {
        const el = container.querySelector<HTMLDivElement>(`[data-id="${focusedId}"]`)
        if (el) placeCaretEnd(el)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks.map(b => b.id).join(',')])

  // Apply review mode masking
  useEffect(() => {
    getBlockEls().forEach(el => {
      if (reviewMode && el.dataset.type === 'important') {
        el.classList.add('masked')
        el.contentEditable = 'false'
      } else {
        el.classList.remove('masked')
        el.contentEditable = 'true'
      }
    })
  }, [reviewMode, blocks])

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLDivElement
    if (!target.classList.contains('block-line')) return

    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) tabPrev?.()
      else tabNext?.()
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const newId = uid()
      const newBlock: Block = { id: newId, type: 'normal', content: '' }
      const curBlocks = readBlocks()
      const idx = getBlockEls().indexOf(target)
      const updated = [
        ...curBlocks.slice(0, idx + 1),
        newBlock,
        ...curBlocks.slice(idx + 1),
      ]
      onUpdate(updated)
      setTimeout(() => {
        const el = containerRef.current?.querySelector<HTMLDivElement>(`[data-id="${newId}"]`)
        if (el) placeCaretEnd(el)
      }, 0)
      return
    }

    if (e.key === 'Backspace') {
      const text = textOf(target)
      const sel = window.getSelection()
      const atStart = sel?.isCollapsed && sel.anchorOffset === 0
      if (text === '' || atStart) {
        const els = getBlockEls()
        const idx = els.indexOf(target)
        if (idx > 0) {
          e.preventDefault()
          const prev = els[idx - 1]
          const prevText = textOf(prev)
          if (text && atStart) {
            // Merge current into prev
            setTextOf(prev, prevText + text)
            updateType(prev)
          }
          const curBlocks = readBlocks()
          onUpdate(curBlocks.filter(b => b.id !== target.dataset.id))
          setTimeout(() => placeCaretEnd(prev), 0)
        }
      }
    }
  }

  function handleInput(e: React.FormEvent<HTMLDivElement>) {
    const target = e.target as HTMLDivElement
    if (!target.classList.contains('block-line')) return
    updateType(target)
    onUpdate(readBlocks())
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const target = e.target as HTMLDivElement
    if (!target.classList.contains('block-line')) return
    const text = e.clipboardData.getData('text/plain')
    const lines = text.split('\n')
    const idx = getBlockEls().indexOf(target)
    const curBlocks = readBlocks()

    // First line merges into current block
    const cur = curBlocks[idx]
    const updated = [...curBlocks]
    updated[idx] = { ...cur, content: cur.content + lines[0], type: detectType(cur.content + lines[0]) }

    // Remaining lines become new blocks
    const extra: Block[] = lines.slice(1).map(l => ({
      id: uid(), type: detectType(l), content: l,
    }))
    updated.splice(idx + 1, 0, ...extra)
    onUpdate(updated)
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest<HTMLDivElement>('.block-line')
    if (target?.classList.contains('masked')) {
      target.classList.remove('masked')
      target.contentEditable = 'true'
      e.stopPropagation()
    }
  }

  return (
    <div
      ref={containerRef}
      className="block-editor flex-1 overflow-y-auto p-2 min-h-0 outline-none"
      onKeyDown={handleKeyDown}
      onInput={handleInput}
      onPaste={handlePaste}
      onClick={handleClick}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
    />
  )
}

// ── Main app ─────────────────────────────────────────────────────────────────
export default function NoteApp() {
  const [notes, setNotes] = useState<Note[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [reviewMode, setReviewMode] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [exportText, setExportText] = useState('')
  const [copied, setCopied] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [mobPanel, setMobPanel] = useState<'notes' | 'cue'>('notes')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cueRef = useRef<HTMLTextAreaElement>(null)
  const sumRef = useRef<HTMLTextAreaElement>(null)

  // Active note derived
  const activeNote = notes.find(n => n.id === activeId) ?? null

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const { notes: saved, activeId: aid } = loadStore()
    if (saved.length > 0) {
      setNotes(saved)
      setActiveId(aid ?? saved[0].id)
    } else {
      const demoBlocks: Block[] = [
        { id: uid(), type: 'normal',    content: '- ここにノートを入力します（行頭に記号を付けて種類を変えられます）' },
        { id: uid(), type: 'important', content: '> 重要・定義：行頭に「> 」で青くハイライト。復習モードでは隠れます' },
        { id: uid(), type: 'question',  content: '? 疑問点：行頭に「? 」でオレンジ。後でキュー欄に書き写す' },
        { id: uid(), type: 'exam',      content: '! 試験に出る：行頭に「! 」で赤。絶対覚えたい内容に' },
        { id: uid(), type: 'cause',     content: '=> 因果関係：行頭に「=> 」で緑。原因→結果の流れを表す' },
        { id: uid(), type: 'normal',    content: '' },
        { id: uid(), type: 'normal',    content: '- Enter で新しい行、Backspace で行を結合、Tab でキュー欄へ移動' },
        { id: uid(), type: 'normal',    content: '- Ctrl+R で復習モード（重要ブロックが隠れる）、Ctrl+/ でヘルプ' },
      ]
      const first: Note = {
        id: uid(), subject: 'ContextNote', topic: '使い方ガイド', session: '第1回', date: todayStr(),
        cue: 'キーワードや問いをここに書く\n\n例：重要なブロックとは？\n→ 復習で隠れる定義・概念',
        summary: '講義後：全体を2〜3文で要約する。コーネル式は「ノート→キュー→まとめ」の3ゾーン構成。',
        blocks: demoBlocks, created: Date.now(), updated: Date.now(),
      }
      setNotes([first])
      setActiveId(first.id)
    }
  }, [])

  // ── Persist ───────────────────────────────────────────────────────────────
  const scheduleSave = useCallback((newNotes: Note[], newActiveId: string | null) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveStore(newNotes, newActiveId)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    }, 800)
  }, [])

  function updateNote(patch: Partial<Note>) {
    setNotes(prev => {
      const next = prev.map(n => n.id === activeId ? { ...n, ...patch, updated: Date.now() } : n)
      scheduleSave(next, activeId)
      return next
    })
  }

  // ── New note ──────────────────────────────────────────────────────────────
  function newNote() {
    const note: Note = {
      id: uid(), subject: '', topic: '', session: '', date: todayStr(),
      cue: '', summary: '', blocks: [], created: Date.now(), updated: Date.now(),
    }
    setNotes(prev => {
      const next = [note, ...prev]
      scheduleSave(next, note.id)
      return next
    })
    setActiveId(note.id)
    setReviewMode(false)
  }

  function deleteNote(id: string) {
    setNotes(prev => {
      const next = prev.filter(n => n.id !== id)
      const newActive = id === activeId ? (next[0]?.id ?? null) : activeId
      setActiveId(newActive)
      scheduleSave(next, newActive)
      if (next.length === 0) newNote()
      return next
    })
  }

  // ── Review ────────────────────────────────────────────────────────────────
  function toggleReview() {
    const next = !reviewMode
    setReviewMode(next)
    if (next) cueRef.current?.focus()
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function openExport() {
    if (!activeNote) return
    const lines = [
      `# ${activeNote.subject || '無題'} ${activeNote.session || ''}`.trimEnd(),
      `**日付:** ${activeNote.date}　**テーマ:** ${activeNote.topic || ''}`,
      '',
      '## ノート',
    ]
    activeNote.blocks.forEach(b => {
      const c = b.content
      if (b.type === 'important') lines.push(`> **${c.replace(/^> /, '')}**`)
      else if (b.type === 'question') lines.push(`- ❓ ${c.replace(/^\? /, '')}`)
      else if (b.type === 'exam')     lines.push(`- ⭐ ${c.replace(/^! /, '')}`)
      else if (b.type === 'cause')    lines.push(`- ⇒ ${c.replace(/^=> /, '')}`)
      else lines.push(`- ${c.replace(/^- /, '')}`)
    })
    if (activeNote.cue) {
      lines.push('', '## キュー・問い', '')
      activeNote.cue.split('\n').forEach(l => lines.push(l))
    }
    if (activeNote.summary) lines.push('', '## まとめ', '', activeNote.summary)
    setExportText(lines.join('\n'))
    setShowExport(true)
  }

  function copyExport() {
    navigator.clipboard.writeText(exportText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      const ta = document.querySelector<HTMLTextAreaElement>('#ex-ta')
      ta?.select()
    })
  }

  // ── Global keyboard ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey
      if (mod) {
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); toggleReview(); return }
        if (e.key === 's' || e.key === 'S') { e.preventDefault(); saveStore(notes, activeId); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000); return }
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); newNote(); return }
        if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setSidebarOpen(p => !p); return }
        if (e.key === '/') { e.preventDefault(); setShowHelp(p => !p); return }
        if (e.key === '1') { e.preventDefault(); cueRef.current?.focus(); return }
        if (e.key === '2') { e.preventDefault(); document.querySelector<HTMLElement>('.block-line')?.focus(); return }
        if (e.key === '3') { e.preventDefault(); sumRef.current?.focus(); return }
      }
      if (e.key === 'Escape') {
        if (showHelp)    { setShowHelp(false); return }
        if (showExport)  { setShowExport(false); return }
        if (reviewMode)  { setReviewMode(false); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMode, showHelp, showExport, notes, activeId])

  // ── Action bar (mobile prefix insert) ────────────────────────────────────
  function insertPrefix(prefix: string) {
    const els = document.querySelectorAll<HTMLDivElement>('.block-line')
    let target = document.activeElement as HTMLDivElement | null
    if (!target?.classList.contains('block-line')) {
      target = els[els.length - 1] || null
    }
    if (!target) {
      updateNote({ blocks: [{ id: uid(), type: detectType(prefix + 'テキスト'), content: prefix }] })
      return
    }
    let text = ''
    target.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) text += n.textContent })
    let bare = text
    for (const p of Object.keys(PREFIXES)) {
      if (text.startsWith(p)) { bare = text.slice(p.length); break }
    }
    const newText = prefix + bare
    ;[...target.childNodes].forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove() })
    target.insertBefore(document.createTextNode(newText), target.firstChild)
    target.dataset.type = detectType(newText)
    const badge = target.querySelector<HTMLSpanElement>('.block-badge')
    if (badge) badge.textContent = BADGE[detectType(newText)] ?? ''
    target.focus()
    const range = document.createRange()
    range.selectNodeContents(target)
    range.collapse(false)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  }

  if (!activeNote) return null

  const noteTitle = (n: Note) =>
    (n.subject || n.topic) ? `${n.subject} ${n.session || ''}`.trim() : '無題'

  // ── Styles ─────────────────────────────────────────────────────────────────
  const hdr = 'flex items-center gap-1 flex-shrink-0'
  const miBase = 'rounded px-2 py-1 text-sm text-white/90 placeholder-white/25 outline-none border border-white/11 bg-white/7 focus:border-[var(--acc)] transition-colors min-w-0'
  const hbtn = (on?: boolean) =>
    `px-2 py-1 rounded text-xs font-mono border transition-colors whitespace-nowrap cursor-pointer ` +
    (on
      ? 'bg-[var(--acc)] border-[var(--acc)] text-white'
      : 'bg-white/7 border-white/12 text-white/65 hover:bg-white/14 hover:text-white')

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>

      {/* Header */}
      <header style={{ background: 'var(--deck)', borderBottom: '1px solid rgba(255,255,255,.05)' }}
        className="flex items-center gap-2 flex-shrink-0 px-4 py-2">
        <div className="flex gap-1.5 flex-1 min-w-0 flex-wrap">
          <input className={`${miBase} flex-[2] min-w-[70px] font-bold`} style={{ fontFamily: 'inherit' }}
            placeholder="科目名" value={activeNote.subject}
            onChange={e => updateNote({ subject: e.target.value })} />
          <input className={`${miBase} flex-[3] min-w-[90px]`} style={{ fontFamily: 'inherit' }}
            placeholder="今日のテーマ" value={activeNote.topic}
            onChange={e => updateNote({ topic: e.target.value })} />
          <input className={`${miBase} w-12 flex-shrink-0 text-center`} style={{ fontFamily: 'IBM Plex Mono, monospace' }}
            placeholder="第?" value={activeNote.session}
            onChange={e => updateNote({ session: e.target.value })} />
          <input className={`${miBase} w-30 flex-shrink-0`} style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}
            type="date" value={activeNote.date}
            onChange={e => updateNote({ date: e.target.value })} />
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button className={hbtn()} onClick={() => setSidebarOpen(p => !p)} title="サイドバー Ctrl+B">☰</button>
          <button className={hbtn(reviewMode)} onClick={toggleReview} title="復習 Ctrl+R">復習</button>
          <button className={hbtn()} onClick={openExport} title="エクスポート">⬇</button>
          <button className={hbtn()} onClick={() => setShowHelp(true)} title="ヘルプ Ctrl+/">?</button>
        </div>
      </header>

      {/* Legend */}
      <div style={{ background: 'var(--surf)', borderBottom: '1px solid var(--edge)', fontFamily: "'IBM Plex Mono', monospace", color: 'var(--fg3)' }}
        className="flex gap-3 flex-shrink-0 px-4 py-1 overflow-x-auto whitespace-nowrap text-[10px]">
        <div className="flex gap-3 flex-1">
          <span className="flex items-center gap-1"><span style={{ background: 'var(--c-imp)', width: 3, height: 12, borderRadius: 1, display: 'inline-block' }} /><code>&gt; </code>重要</span>
          <span className="flex items-center gap-1"><span style={{ background: 'var(--c-q)',   width: 3, height: 12, borderRadius: 1, display: 'inline-block' }} /><code>? </code>疑問</span>
          <span className="flex items-center gap-1"><span style={{ background: 'var(--c-ex)',  width: 3, height: 12, borderRadius: 1, display: 'inline-block' }} /><code>! </code>試験</span>
          <span className="flex items-center gap-1"><span style={{ background: 'var(--c-ca)',  width: 3, height: 12, borderRadius: 1, display: 'inline-block' }} /><code>=&gt; </code>因果</span>
        </div>
      </div>

      {/* Mobile tabs */}
      <div className="hidden max-[700px]:flex" style={{ background: 'var(--deck)', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
        {(['notes', 'cue'] as const).map(tab => (
          <button key={tab} onClick={() => setMobPanel(tab)}
            style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `2px solid ${mobPanel === tab ? 'var(--acc)' : 'transparent'}`,
              color: mobPanel === tab ? '#fff' : 'rgba(255,255,255,.45)', cursor: 'pointer',
              fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, padding: '8px 4px',
              textTransform: 'uppercase', letterSpacing: '.06em' }}>
            {tab === 'notes' ? 'ノート' : 'キュー'}
          </button>
        ))}
      </div>

      {/* Main app layout */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Sidebar */}
        <aside style={{
          background: 'var(--surf-side)', borderRight: '1px solid var(--edge)',
          width: sidebarOpen ? 210 : 0, flexShrink: 0, overflow: 'hidden', transition: 'width .22s',
        }} className="max-[700px]:hidden flex flex-col">
          <div style={{ background: 'var(--deck)' }}
            className="flex items-center justify-between px-3 py-2 flex-shrink-0">
            <span style={{ color: 'rgba(255,255,255,.55)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>ノート一覧</span>
            <button onClick={newNote} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,.65)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
              title="新規ノート">+</button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {notes.map(n => (
              <div key={n.id} onClick={() => { setActiveId(n.id); setReviewMode(false) }}
                style={{
                  padding: '8px 11px', cursor: 'pointer', position: 'relative',
                  borderLeft: `3px solid ${n.id === activeId ? 'var(--acc)' : 'transparent'}`,
                  background: n.id === activeId ? 'var(--acc-dim)' : 'transparent',
                  transition: 'background .12s',
                }}
                className="group">
                <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 16 }}>{noteTitle(n)}</div>
                <div style={{ color: 'var(--fg3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, marginTop: 2 }}>{n.date}</div>
                <button onClick={e => { e.stopPropagation(); deleteNote(n.id) }}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--fg3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
                  className="opacity-0 group-hover:opacity-100 hover:!text-[var(--c-ex)]">×</button>
              </div>
            ))}
          </div>
        </aside>

        {/* Cornell content */}
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="flex flex-1 overflow-hidden min-h-0">

            {/* Cue panel */}
            <div className={`panel-wrap flex flex-col flex-shrink-0 border-r
              max-[700px]:absolute max-[700px]:inset-0 max-[700px]:z-10 max-[700px]:transition-opacity
              ${mobPanel === 'cue' ? 'max-[700px]:opacity-100 max-[700px]:pointer-events-auto' : 'max-[700px]:opacity-0 max-[700px]:pointer-events-none'}`}
              style={{ width: 'min(30%, 300px)', minWidth: 140, background: 'var(--surf-cue)', borderColor: 'var(--edge)', position: 'relative' }}>
              <div className="flex items-center justify-between flex-shrink-0 px-3 py-1.5"
                style={{ borderBottom: '1px solid var(--edge)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--fg3)' }}>
                <span>キュー・問い</span>
                <span className="pact text-[9px] px-1 rounded border opacity-0 transition-opacity"
                  style={{ background: 'var(--acc-dim)', borderColor: 'var(--acc)', color: 'var(--acc)' }}>ACTIVE</span>
              </div>
              <textarea ref={cueRef} className="flex-1 w-full resize-none outline-none p-3 text-[13px] leading-[1.85]"
                style={{ background: 'transparent', border: 'none', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--fg)', caretColor: 'var(--acc)' }}
                placeholder={'講義後に記入\n\nキーワードや問いを書く\n\nTab で「ノート」へ'}
                value={activeNote.cue}
                onChange={e => updateNote({ cue: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) sumRef.current?.focus(); else document.querySelector<HTMLElement>('.block-line')?.focus() }
                }} />
            </div>

            {/* Notes panel */}
            <div className={`panel-wrap flex flex-col flex-1 min-w-0 relative
              max-[700px]:absolute max-[700px]:inset-0
              ${mobPanel === 'notes' ? 'max-[700px]:opacity-100 max-[700px]:pointer-events-auto max-[700px]:z-10' : 'max-[700px]:opacity-0 max-[700px]:pointer-events-none max-[700px]:z-0'}`}
              style={{ background: 'var(--surf)' }}>
              <div className="flex items-center justify-between flex-shrink-0 px-3 py-1.5"
                style={{ borderBottom: '1px solid var(--edge)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--fg3)' }}>
                <span>ノート欄</span>
                <span className="pact text-[9px] px-1 rounded border opacity-0 transition-opacity"
                  style={{ background: 'var(--acc-dim)', borderColor: 'var(--acc)', color: 'var(--acc)' }}>ACTIVE</span>
              </div>
              <BlockEditor
                blocks={activeNote.blocks}
                onUpdate={blocks => updateNote({ blocks })}
                reviewMode={reviewMode}
                tabNext={() => sumRef.current?.focus()}
                tabPrev={() => cueRef.current?.focus()}
              />
              {/* Mobile action bar */}
              <div className="hidden max-[700px]:flex flex-wrap gap-1 p-2 flex-shrink-0"
                style={{ background: 'var(--deck)', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                {([['> ', '▐ 定義', 'var(--c-imp)'], ['? ', '? 疑問', 'var(--c-q)'], ['! ', '★ 試験', 'var(--c-ex)'], ['=> ', '⇒ 因果', 'var(--c-ca)'], ['- ', '- 通常', 'rgba(255,255,255,.5)']] as [string, string, string][]).map(([p, label, col]) => (
                  <button key={p} onClick={() => insertPrefix(p)}
                    style={{ background: 'rgba(255,255,255,.08)', border: `1px solid ${col}`, borderRadius: 5, color: col, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, padding: '5px 10px', cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* Summary */}
          <div className="panel-wrap flex flex-col flex-shrink-0" style={{ background: 'var(--surf)', borderTop: '1px solid var(--edge)' }}>
            <div className="flex items-center justify-between flex-shrink-0 px-3 py-1.5"
              style={{ borderBottom: '1px solid var(--edge)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--fg3)' }}>
              <span>まとめ</span>
              <span className="pact text-[9px] px-1 rounded border opacity-0 transition-opacity"
                style={{ background: 'var(--acc-dim)', borderColor: 'var(--acc)', color: 'var(--acc)' }}>ACTIVE</span>
            </div>
            <textarea ref={sumRef} className="w-full resize-none outline-none px-3 py-2 text-[13px] leading-[1.75]"
              style={{ height: 80, background: 'transparent', border: 'none', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--fg)', caretColor: 'var(--acc)' }}
              placeholder="講義後：全体を2〜3文で要約する　Tab でキュー欄へ"
              value={activeNote.summary}
              onChange={e => updateNote({ summary: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) document.querySelector<HTMLElement>('.block-line')?.focus(); else cueRef.current?.focus() }
              }} />
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 flex-shrink-0 px-4 py-1 overflow-x-auto whitespace-nowrap"
        style={{ background: 'var(--deck)', borderTop: '1px solid rgba(255,255,255,.04)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
        {[['Tab', '次のパネル'], ['Ctrl+1/2/3', '直接移動'], ['Ctrl+R', '復習'], ['Ctrl+S', '保存'], ['Ctrl+/', 'ヘルプ']].map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <kbd style={{ background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 3, padding: '0 4px', fontSize: 9, color: 'rgba(255,255,255,.6)' }}>{k}</kbd>
            {v}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: savedFlash ? '#5ac87a' : 'transparent', transition: 'color .4s' }}>✓ 保存済み</span>
        {reviewMode && <span style={{ color: 'var(--acc)', fontWeight: 600 }}>復習モード</span>}
      </div>

      {/* Help overlay */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5" style={{ background: 'rgba(0,0,0,.68)' }}
          onClick={() => setShowHelp(false)}>
          <div className="rounded-xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto"
            style={{ background: 'var(--surf)', border: '1px solid var(--edge)' }}
            onClick={e => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold mb-4">⌨ キーボードショートカット</h2>
            {[
              ['パネル移動', [['Tab', '次のパネルへ（ノート→キュー→まとめ）'], ['Shift+Tab', '前のパネルへ'], ['Ctrl+1', 'キュー欄'], ['Ctrl+2', 'ノート欄'], ['Ctrl+3', 'まとめ欄']]],
              ['アプリ操作', [['Ctrl+R', '復習モード（重要ブロックをマスク）'], ['Ctrl+S', '手動保存'], ['Ctrl+N', '新規ノート'], ['Ctrl+B', 'サイドバー開閉'], ['Ctrl+/', 'ヘルプ'], ['Escape', '閉じる/終了']]],
              ['セマンティックプレフィックス', [['> テキスト', '重要・定義（復習マスク対象）'], ['? テキスト', '疑問点'], ['! テキスト', '試験に出る'], ['=> テキスト', '因果関係'], ['- テキスト', '通常ノート']]],
            ].map(([section, rows]) => (
              <div key={section as string} className="mb-4">
                <div style={{ color: 'var(--fg3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>{section as string}</div>
                {(rows as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex gap-3 py-1.5 text-[13px]" style={{ borderBottom: '1px solid var(--edge)' }}>
                    <kbd className="flex-shrink-0 w-36" style={{ background: 'var(--bg)', border: '1px solid var(--edge)', borderBottomWidth: 2, borderRadius: 4, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, padding: '1px 7px', color: 'var(--fg)' }}>{k}</kbd>
                    <span style={{ color: 'var(--fg2)' }}>{v}</span>
                  </div>
                ))}
              </div>
            ))}
            <button className="block mx-auto mt-3 px-5 py-1.5 rounded-md text-[13px] cursor-pointer"
              style={{ background: 'var(--acc-dim)', border: '1px solid var(--acc)', color: 'var(--acc)' }}
              onClick={() => setShowHelp(false)}>閉じる（Esc）</button>
          </div>
        </div>
      )}

      {/* Export overlay */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5" style={{ background: 'rgba(0,0,0,.68)' }}
          onClick={() => setShowExport(false)}>
          <div className="rounded-xl p-5 max-w-xl w-full max-h-[72vh] overflow-hidden flex flex-col gap-3"
            style={{ background: 'var(--surf)', border: '1px solid var(--edge)' }}
            onClick={e => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold m-0">Markdown エクスポート</h2>
            <textarea id="ex-ta" readOnly value={exportText}
              className="flex-1 rounded-md p-3 text-[12px] resize-none outline-none min-h-[200px]"
              style={{ background: 'var(--bg)', border: '1px solid var(--edge)', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--fg)' }} />
            <div className="flex justify-end gap-2">
              <button className="px-4 py-1.5 rounded-md text-[13px] cursor-pointer"
                style={{ background: 'transparent', border: '1px solid var(--edge)', color: 'var(--fg2)' }}
                onClick={() => setShowExport(false)}>閉じる</button>
              <button className="px-4 py-1.5 rounded-md text-[13px] cursor-pointer"
                style={{ background: 'var(--acc-dim)', border: '1px solid var(--acc)', color: 'var(--acc)' }}
                onClick={copyExport}>{copied ? 'コピー済み ✓' : 'コピー'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
