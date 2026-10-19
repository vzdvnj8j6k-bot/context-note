'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Block, BlockType, Note } from '@/lib/types'
import { loadStore, saveStore, uid, todayStr } from '@/lib/store'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

// ── Prefix → block type ────────────────────────────────────────────────────
const PREFIXES: Record<string, BlockType> = {
  '> ':  'important',
  '? ':  'question',
  '! ':  'exam',
  '=> ': 'cause',
  '~ ':  'reaction',
  '- ':  'normal',
}
// Reverse map: type → prefix for reconstruct on save
const TYPE_TO_PREFIX: Partial<Record<BlockType, string>> = {
  important: '> ', question: '? ', exam: '! ', cause: '=> ', reaction: '~ ', normal: '- ',
}
const BADGE: Partial<Record<BlockType, string>> = {
  important: '重要', question: '疑問', exam: '試験', cause: '因果', reaction: '感想',
}
const CHAR_WARN = 50
const CHAR_OVER = 60

// Slash command definitions (shared by BlockEditor and NoteApp)
const SLASH_CMDS = [
  { prefix: '> ',  label: '重要・定義',    hint: '復習で隠れる',      color: 'var(--c-imp)' },
  { prefix: '? ',  label: '疑問点',         hint: 'なぜ？どうして？',  color: 'var(--c-q)' },
  { prefix: '! ',  label: '試験ポイント',   hint: '絶対覚えたい',      color: 'var(--c-ex)' },
  { prefix: '=> ', label: '因果関係',       hint: '原因 → 結果',       color: 'var(--c-ca)' },
  { prefix: '~ ',  label: '感想・反応',     hint: '面白い！なぜ！',    color: 'var(--c-rx)' },
  { prefix: '- ',  label: '通常メモ',       hint: '普通の箇条書き',    color: 'var(--fg3)' },
]

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
  const [slashMenu, setSlashMenu] = useState<{
    blockId: string; top: number; left: number; selectedIdx: number
  } | null>(null)

  function getBlockEls(): HTMLDivElement[] {
    if (!containerRef.current) return []
    return [...containerRef.current.querySelectorAll<HTMLDivElement>('.block-line')]
  }

  function readBlocks(): Block[] {
    return getBlockEls().map(el => {
      const type = (el.dataset.type as BlockType) || 'normal'
      const prefix = TYPE_TO_PREFIX[type] ?? ''
      return {
        id: el.dataset.id!,
        type,
        content: prefix + textOf(el),
        level: parseInt(el.dataset.level ?? '0') || 0,
      }
    })
  }

  function textOf(el: HTMLDivElement): string {
    let t = ''
    el.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) t += n.textContent })
    return t
  }

  function setTextOf(el: HTMLDivElement, text: string) {
    ;[...el.childNodes].forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove() })
    el.insertBefore(document.createTextNode(text), el.firstChild)
  }

  function updateType(el: HTMLDivElement) {
    // Type is set via el.dataset.type; this just syncs the badge and char counter.
    const type = (el.dataset.type as BlockType) || 'normal'
    const badge = el.querySelector<HTMLSpanElement>('.block-badge')
    if (badge) badge.textContent = BADGE[type] ?? ''
    const counter = el.querySelector<HTMLSpanElement>('.char-count')
    if (counter) {
      const len = textOf(el).length
      counter.textContent = `${len}`
      counter.dataset.warn = len >= CHAR_OVER ? 'over' : len >= CHAR_WARN ? 'warn' : 'ok'
    }
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
    div.dataset.level = String(block.level ?? 0)
    div.dataset.ph = '入力 または / でブロック種類を選ぶ'
    // Strip the stored prefix so only the content text is shown
    const storedPrefix = TYPE_TO_PREFIX[block.type] ?? ''
    const displayText = block.content.startsWith(storedPrefix) ? block.content.slice(storedPrefix.length) : block.content
    div.appendChild(document.createTextNode(displayText))

    const badge = document.createElement('span')
    badge.className = 'block-badge'
    badge.textContent = BADGE[block.type] ?? ''
    div.appendChild(badge)

    const counter = document.createElement('span')
    counter.className = 'char-count'
    const len = block.content.length
    counter.textContent = `${len}`
    counter.dataset.warn = len >= CHAR_OVER ? 'over' : len >= CHAR_WARN ? 'warn' : 'ok'
    div.appendChild(counter)

    // (mask-cover removed — review mode uses ghost-text overlay)

    return div
  }

  // Slash command: apply selected type (prefix used only to detect type)
  function selectSlashCmd(prefix: string) {
    if (!slashMenu) return
    const el = containerRef.current?.querySelector<HTMLDivElement>(`[data-id="${slashMenu.blockId}"]`)
    if (el) {
      el.dataset.type = detectType(prefix + 'x')
      setTextOf(el, '')  // clear the '/' trigger char
      updateType(el)
      placeCaretEnd(el)
    }
    setSlashMenu(null)
    onUpdate(readBlocks())
  }

  // Initial render and block list sync
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const existing = getBlockEls()

    if (existing.length === 0 || blocks.length === 0) {
      container.innerHTML = ''
      blocks.forEach(b => container.appendChild(createBlockEl(b)))
      if (blocks.length === 0) {
        const b: Block = { id: uid(), type: 'normal', content: '' }
        container.appendChild(createBlockEl(b))
      }
      return
    }

    const existingIds = existing.map(e => e.dataset.id)
    const blockIds = blocks.map(b => b.id)

    if (JSON.stringify(existingIds) !== JSON.stringify(blockIds)) {
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

  // Review mode: ghost text (faint original) + user types recall on top
  useEffect(() => {
    getBlockEls().forEach(el => {
      if (reviewMode) {
        if (el.dataset.reviewOrig !== undefined) return // already set up
        const origText = textOf(el)
        el.dataset.reviewOrig = origText
        const ghost = document.createElement('span')
        ghost.className = 'ghost-text'
        ghost.setAttribute('contenteditable', 'false')
        ghost.textContent = origText
        el.insertBefore(ghost, el.firstChild)
        setTextOf(el, '')
        el.classList.add('masked')
        el.contentEditable = 'true'
      } else {
        el.classList.remove('masked')
        const ghost = el.querySelector<HTMLSpanElement>('.ghost-text')
        const origText = el.dataset.reviewOrig
        if (ghost) ghost.remove()
        if (origText !== undefined) {
          setTextOf(el, origText)
          delete el.dataset.reviewOrig
        }
        el.contentEditable = 'true'
      }
    })
  }, [reviewMode, blocks])

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLDivElement
    if (!target.classList.contains('block-line')) return

    // In review mode: allow typing, block structural changes
    if (reviewMode) {
      if (e.key === 'Enter') { e.preventDefault(); return }
      if (e.key === 'Tab')   { e.preventDefault(); return }
      if (e.key === 'Backspace') {
        const sel = window.getSelection()
        const atStart = sel?.isCollapsed && sel.anchorOffset === 0
        if (atStart && getBlockEls().indexOf(target) > 0) { e.preventDefault(); return }
      }
      return // skip all other custom handlers; browser default (typing) still works
    }

    // Slash menu keyboard navigation
    if (slashMenu) {
      if (e.key === 'Escape') {
        e.preventDefault()
        const el = containerRef.current?.querySelector<HTMLDivElement>(`[data-id="${slashMenu.blockId}"]`)
        if (el) { setTextOf(el, ''); updateType(el); placeCaretEnd(el) }
        setSlashMenu(null)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashMenu(m => m ? { ...m, selectedIdx: (m.selectedIdx + 1) % SLASH_CMDS.length } : m)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashMenu(m => m ? { ...m, selectedIdx: (m.selectedIdx - 1 + SLASH_CMDS.length) % SLASH_CMDS.length } : m)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        selectSlashCmd(SLASH_CMDS[slashMenu.selectedIdx].prefix)
        return
      }
      // Number keys 1-6 for quick selection
      const numIdx = ['1','2','3','4','5','6'].indexOf(e.key)
      if (numIdx >= 0) {
        e.preventDefault()
        selectSlashCmd(SLASH_CMDS[numIdx].prefix)
        return
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      const text = textOf(target)
      if (!text) {
        // Empty block: switch panel
        if (e.shiftKey) tabPrev?.()
        else tabNext?.()
      } else {
        // Non-empty block: indent / outdent
        const currentLevel = parseInt(target.dataset.level ?? '0') || 0
        const newLevel = e.shiftKey ? Math.max(0, currentLevel - 1) : Math.min(3, currentLevel + 1)
        target.dataset.level = String(newLevel)
        onUpdate(readBlocks())
      }
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
      if (slashMenu) setSlashMenu(null)
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
    if (reviewMode) return  // typing in review mode is ephemeral practice, don't save
    const target = e.target as HTMLDivElement
    if (!target.classList.contains('block-line')) return
    const text = textOf(target)

    // Show slash command menu when / typed at start of block
    if (text === '/') {
      const rect = target.getBoundingClientRect()
      setSlashMenu({ blockId: target.dataset.id!, top: rect.bottom, left: rect.left, selectedIdx: 0 })
      return // Don't update type yet
    } else if (slashMenu && slashMenu.blockId === target.dataset.id && !text.startsWith('/')) {
      setSlashMenu(null)
    } else if (slashMenu && slashMenu.blockId !== target.dataset.id) {
      setSlashMenu(null)
    }

    // If user typed a prefix (e.g. '> ', '? '), auto-convert the block type and strip the prefix
    let detectedByPrefix = false
    for (const [prefix, type] of Object.entries(PREFIXES)) {
      if (text.startsWith(prefix)) {
        target.dataset.type = type
        setTextOf(target, text.slice(prefix.length))
        updateType(target)
        placeCaretEnd(target)
        detectedByPrefix = true
        break
      }
    }
    if (!detectedByPrefix) updateType(target)
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

    const cur = curBlocks[idx]
    const updated = [...curBlocks]
    updated[idx] = { ...cur, content: cur.content + lines[0], type: detectType(cur.content + lines[0]) }

    const extra: Block[] = lines.slice(1).map(l => ({
      id: uid(), type: detectType(l), content: l,
    }))
    updated.splice(idx + 1, 0, ...extra)
    onUpdate(updated)
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest<HTMLDivElement>('.block-line')
    if (!target) return
    void target // used below via fallthrough
  }

  return (
    <>
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
      {/* Slash command picker */}
      {slashMenu && (
        <div
          style={{
            position: 'fixed',
            top: slashMenu.top + 4,
            left: slashMenu.left,
            zIndex: 200,
            background: 'var(--surf)',
            border: '1px solid var(--edge)',
            borderRadius: 10,
            boxShadow: '0 6px 24px rgba(0,0,0,.13)',
            minWidth: 260,
            overflow: 'hidden',
            fontFamily: 'inherit',
          }}
        >
          <div style={{ padding: '6px 12px 5px', fontSize: 10, color: 'var(--fg3)', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.08em', textTransform: 'uppercase', borderBottom: '1px solid var(--edge)' }}>
            ブロックの種類を選ぶ
          </div>
          {SLASH_CMDS.map((cmd, i) => (
            <div
              key={cmd.prefix}
              onMouseDown={e => { e.preventDefault(); selectSlashCmd(cmd.prefix) }}
              style={{
                padding: '9px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: i === slashMenu.selectedIdx ? 'var(--acc-dim)' : 'transparent',
                borderLeft: `3px solid ${i === slashMenu.selectedIdx ? 'var(--acc)' : 'transparent'}`,
              }}
            >
              <span style={{ color: 'var(--fg3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, width: 14, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ color: cmd.color, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, width: 28, flexShrink: 0 }}>{cmd.prefix.trim()}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{cmd.label}</div>
                <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 1 }}>{cmd.hint}</div>
              </div>
            </div>
          ))}
          <div style={{ padding: '5px 12px 6px', fontSize: 10, color: 'var(--fg3)', fontFamily: 'IBM Plex Mono, monospace', borderTop: '1px solid var(--edge)' }}>
            ↑↓ 選択 · Enter 確定 · Esc 閉じる
          </div>
        </div>
      )}
    </>
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
  const [mobPanel, setMobPanel] = useState<'notes' | 'cue' | 'summary'>('notes')
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return !localStorage.getItem('ctx-visited') } catch { return false }
  })
  const [syncing, setSyncing] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [mobNoteList, setMobNoteList] = useState(false)
  const [aiCopied, setAiCopied] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userRef = useRef<User | null>(null)
  const cueRef = useRef<HTMLDivElement>(null)
  const sumRef = useRef<HTMLTextAreaElement>(null)

  const activeNote = notes.find(n => n.id === activeId) ?? null

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      userRef.current = u
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      userRef.current = u
      if (u) { setShowWelcome(false); try { localStorage.setItem('ctx-visited', '1') } catch {} }
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return
    if (user) {
      loadFromSupabase()
    } else {
      loadLocal()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading])

  // ── Persist ───────────────────────────────────────────────────────────────
  const scheduleSave = useCallback((newNotes: Note[], newActiveId: string | null) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      saveStore(newNotes, newActiveId)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
      if (userRef.current) {
        await upsertToSupabase(newNotes)
      }
    }, 800)
  }, [])

  function switchNote(id: string) {
    setActiveId(id)
    try { const s = loadStore(); saveStore(s.notes, id) } catch {}
  }

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
      cue: '', summary: '', blocks: [{ id: uid(), type: 'normal', content: '- ', level: 0 }], created: Date.now(), updated: Date.now(),
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
    if (userRef.current) deleteFromSupabase(id)
    setNotes(prev => {
      const next = prev.filter(n => n.id !== id)
      const newActive = id === activeId ? (next[0]?.id ?? null) : activeId
      setActiveId(newActive)
      scheduleSave(next, newActive)
      if (next.length === 0) newNote()
      return next
    })
  }

  // ── Supabase helpers ──────────────────────────────────────────────────────
  function createFirstNote() {
    const first: Note = {
      id: uid(), subject: '', topic: '', session: '', date: todayStr(),
      cue: '', summary: '', blocks: [{ id: uid(), type: 'normal', content: '- ', level: 0 }], created: Date.now(), updated: Date.now(),
    }
    setNotes([first])
    setActiveId(first.id)
  }

  function isDemoNote(n: Note) {
    return n.subject === '生物学' && n.topic === '進化論と自然選択'
  }

  function loadLocal() {
    const { notes: saved, activeId: aid } = loadStore()
    const cleaned = saved.filter(n => !isDemoNote(n))
    if (cleaned.length === 0) {
      createFirstNote()
    } else {
      if (cleaned.length < saved.length) saveStore(cleaned, aid ?? cleaned[0].id)
      setNotes(cleaned)
      setActiveId(aid && cleaned.find(n => n.id === aid) ? aid : cleaned[0].id)
    }
  }

  async function loadFromSupabase() {
    setSyncing(true)
    try {
      const { data, error } = await supabase
        .from('notes')
        .select('data, updated')
        .order('updated', { ascending: false })
      if (error) throw error
      if (data && data.length > 0) {
        const remoteNotes = data.map(r => r.data as Note)
        const cleaned = remoteNotes.filter(n => !isDemoNote(n))
        if (cleaned.length === 0) {
          createFirstNote()
        } else {
          setNotes(cleaned)
          // Restore last-viewed note (Word-like resume)
          const { activeId: localAid } = loadStore()
          const restoredId = localAid && cleaned.find(n => n.id === localAid) ? localAid : cleaned[0].id
          setActiveId(restoredId)
          if (cleaned.length < remoteNotes.length) {
            const demoIds = remoteNotes.filter(n => isDemoNote(n)).map(n => n.id)
            await Promise.all(demoIds.map(id => supabase.from('notes').delete().eq('id', id)))
          }
        }
      } else {
        // New user: migrate existing local notes to Supabase
        const { notes: local, activeId: localActive } = loadStore()
        const cleanedLocal = local.filter(n => !isDemoNote(n))
        if (cleanedLocal.length > 0) {
          setNotes(cleanedLocal)
          setActiveId(localActive && cleanedLocal.find(n => n.id === localActive) ? localActive : cleanedLocal[0].id)
          const rows = cleanedLocal.map(n => ({ id: n.id, user_id: userRef.current!.id, data: n, updated: n.updated }))
          await supabase.from('notes').upsert(rows)
        } else {
          createFirstNote()
        }
      }
    } catch (e) {
      console.error('Supabase load failed:', e)
      loadLocal()
    } finally {
      setSyncing(false)
    }
  }

  async function upsertToSupabase(notesToSave: Note[]) {
    if (!userRef.current) return
    const rows = notesToSave.map(n => ({
      id: n.id, user_id: userRef.current!.id, data: n, updated: n.updated,
    }))
    await supabase.from('notes').upsert(rows)
  }

  async function deleteFromSupabase(id: string) {
    if (!userRef.current) return
    await supabase.from('notes').delete().eq('id', id).eq('user_id', userRef.current.id)
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
      else if (b.type === 'reaction') lines.push(`- ～ ${c.replace(/^~ /, '')}`)
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

  // ── AI explain ────────────────────────────────────────────────────────────
  function buildNoteText(n: Note): string {
    const lines: string[] = []
    lines.push(`# ${n.subject} ${n.session ? '第' + n.session + '回' : ''} ${n.topic}`)
    lines.push(`日付: ${n.date}`, '')
    lines.push('## ノート本文', '')
    n.blocks.forEach(b => {
      const c = b.content
      const indent = '  '.repeat(b.level ?? 0)
      if (b.type === 'important') lines.push(`${indent}[重要] ${c.replace(/^> /, '')}`)
      else if (b.type === 'question') lines.push(`${indent}[疑問] ${c.replace(/^\? /, '')}`)
      else if (b.type === 'exam') lines.push(`${indent}[試験] ${c.replace(/^! /, '')}`)
      else if (b.type === 'cause') lines.push(`${indent}[因果] ${c.replace(/^=> /, '')}`)
      else if (b.type === 'reaction') lines.push(`${indent}[感想] ${c.replace(/^~ /, '')}`)
      else lines.push(`${indent}${c.replace(/^- /, '')}`)
    })
    const CORNELL_QUESTIONS = ['定義・概念は何か？', 'なぜ・どのように起きるのか？', '具体的な例は？', '他の概念・以前の内容との違いは？', '試験で問われそうな点は？']
    let cueAnswers: string[] = []
    try { cueAnswers = JSON.parse(n.cue) } catch {}
    if (!Array.isArray(cueAnswers)) cueAnswers = []
    const hasCue = cueAnswers.some(a => a.trim())
    if (hasCue) {
      lines.push('', '## キュー（質問と回答）', '')
      CORNELL_QUESTIONS.forEach((q, i) => {
        if (cueAnswers[i]?.trim()) lines.push(`Q: ${q}`, `A: ${cueAnswers[i]}`, '')
      })
    }
    if (n.summary.trim()) lines.push('## まとめ', '', n.summary)
    return lines.join('\n')
  }

  function copyForAI() {
    if (!activeNote) return
    const prompt = `以下の授業ノートを読んで、分かりやすく解説してください。

${buildNoteText(activeNote)}

---
お願いしたいこと：
1. このノートの一番大事なポイントを3〜5つ、分かりやすく整理してください
2. 難しい言葉や概念があれば、身近な例を使って説明してください
3. 試験に出そうな問いと答えを2〜3つ作ってください`

    navigator.clipboard.writeText(prompt).then(() => {
      setAiCopied(true)
      setTimeout(() => setAiCopied(false), 4000)
    }).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = prompt
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setAiCopied(true)
      setTimeout(() => setAiCopied(false), 4000)
    })
  }

  // ── Share ─────────────────────────────────────────────────────────────────
  async function shareNote() {
    if (!activeNote) return
    setShareLoading(true)
    try {
      const { data, error } = await supabase
        .from('shares')
        .insert({ note_data: activeNote, created_by: userRef.current?.id ?? null })
        .select('id')
        .single()
      if (error || !data) throw error
      const url = `${window.location.origin}/share/${data.id}`
      setShareUrl(url)
      navigator.clipboard.writeText(url).catch(() => {})
    } catch { alert('共有に失敗しました。ログイン後に再試行してください。') }
    setShareLoading(false)
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
        if (e.key === '1' && !e.shiftKey) { e.preventDefault(); cueRef.current?.focus(); return }
        if (e.key === '2' && !e.shiftKey) { e.preventDefault(); document.querySelector<HTMLElement>('.block-line')?.focus(); return }
        if (e.key === '3' && !e.shiftKey) { e.preventDefault(); sumRef.current?.focus(); return }
        // Ctrl+Shift+1-6: change focused block type
        if (e.shiftKey) {
          const numIdx = ['1','2','3','4','5','6'].indexOf(e.key)
          if (numIdx >= 0) {
            e.preventDefault()
            insertPrefix(SLASH_CMDS[numIdx].prefix)
            return
          }
        }
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

  // ── Insert prefix (mobile action bar + empty state card) ──────────────────
  function insertPrefix(prefix: string) {
    const els = document.querySelectorAll<HTMLDivElement>('.block-line')
    let target = document.activeElement as HTMLDivElement | null
    if (!target?.classList.contains('block-line')) {
      target = els[els.length - 1] || null
    }
    if (!target) {
      // No block focused: create a new block with this type
      updateNote({ blocks: [{ id: uid(), type: detectType(prefix + 'x'), content: prefix }] })
      return
    }
    // Change only the type; display text (already prefix-stripped) stays as-is
    const newType = detectType(prefix + 'x')
    target.dataset.type = newType
    const badge = target.querySelector<HTMLSpanElement>('.block-badge')
    if (badge) badge.textContent = BADGE[newType] ?? ''
    target.focus()
    const range = document.createRange()
    range.selectNodeContents(target)
    range.collapse(false)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', color: 'var(--fg3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
        接続中...
      </div>
    )
  }

  if (!activeNote) return null

  // ── Welcome / Login screen ────────────────────────────────────────────────
  function dismissWelcome() {
    try { localStorage.setItem('ctx-visited', '1') } catch {}
    setShowWelcome(false)
  }

  const FEATURES = [
    { icon: '📝', title: 'コーネル式ノート', desc: 'キュー・ノート・まとめの3分割で\n授業内容を構造的に整理' },
    { icon: '🔍', title: '復習モード', desc: 'ノートを隠して記憶を確認。\n薄く透けた文字の上から書き直し' },
    { icon: '☁', title: 'どこでも同期', desc: 'Googleアカウントでログインすると\nスマホ・PCで自動同期' },
  ]

  const WelcomeScreen = showWelcome && !user ? (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: '#0d0d1a',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      overflowY: 'auto',
      padding: '0 20px 40px',
    }}>
      {/* Gradient accent bar */}
      <div style={{ width: '100%', height: 3, background: 'linear-gradient(90deg, #2f52d4, #7c3aed, #c06800)', flexShrink: 0 }} />

      <div style={{ maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Logo area */}
        <div style={{ marginTop: 52, marginBottom: 8, display: 'flex', gap: 5 }}>
          {[['重要','#2f52d4'],['疑問','#c06800'],['試験','#b01818']].map(([t,c]) => (
            <span key={t} style={{
              background: `${c}22`, border: `1px solid ${c}88`,
              color: c, borderRadius: 6, padding: '4px 11px',
              fontSize: 12, fontFamily: 'Noto Sans JP, sans-serif', fontWeight: 700, letterSpacing: '.03em',
            }}>{t}</span>
          ))}
        </div>
        <h1 style={{
          color: '#fff', fontSize: 30, fontWeight: 800, margin: '10px 0 6px',
          fontFamily: 'Noto Sans JP, sans-serif', letterSpacing: '-.01em',
        }}>コーネルノート</h1>
        <p style={{
          color: 'rgba(255,255,255,.4)', fontSize: 13, margin: '0 0 36px',
          fontFamily: 'Noto Sans JP, sans-serif', textAlign: 'center', lineHeight: 1.6,
        }}>授業・講義を記録して、効率よく復習する</p>

        {/* Feature cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginBottom: 32 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)',
              borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{f.icon}</span>
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: 'Noto Sans JP, sans-serif', marginBottom: 3 }}>{f.title}</div>
                <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, fontFamily: 'Noto Sans JP, sans-serif', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Google login button */}
        <button
          onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            background: '#fff', border: 'none', borderRadius: 12,
            padding: '15px 20px', cursor: 'pointer', marginBottom: 10,
            fontSize: 15, fontWeight: 700, color: '#1a1a2e',
            fontFamily: 'Noto Sans JP, sans-serif',
            boxShadow: '0 2px 16px rgba(47,82,212,.25)',
          }}>
          <svg width="20" height="20" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.3 1.2 8.4 3.2l6.2-6.2C34.5 3 29.6 1 24 1 14.9 1 7.2 6.4 3.8 14l7.3 5.7C12.9 13.5 18 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.4-4.8 7.1l7.4 5.7c4.3-4 6.8-9.9 6.8-16.7z"/>
            <path fill="#FBBC05" d="M11.1 28.3A14.5 14.5 0 0 1 9.5 24c0-1.5.3-3 .7-4.3L3 14C1.1 17.4 0 21.1 0 25c0 3.9 1.1 7.5 2.9 10.7l8.2-6.3z"/>
            <path fill="#34A853" d="M24 47c5.5 0 10.2-1.8 13.6-4.9l-7.4-5.7c-1.9 1.3-4.3 2.1-6.9 2.1-5.7 0-10.5-3.8-12.3-9l-8.2 6.3C7.1 42.8 15 47 24 47z"/>
          </svg>
          Googleでログイン
        </button>
        <p style={{ color: 'rgba(255,255,255,.22)', fontSize: 11, fontFamily: 'Noto Sans JP, sans-serif', margin: '0 0 20px', textAlign: 'center' }}>
          無料・広告なし・複数デバイス同期
        </p>

        {/* Skip */}
        <button
          onClick={dismissWelcome}
          style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,.12)',
            borderRadius: 8, color: 'rgba(255,255,255,.4)', fontSize: 13,
            fontFamily: 'Noto Sans JP, sans-serif', cursor: 'pointer', padding: '10px 24px',
            width: '100%',
          }}>
          ログインせずに使う（このデバイスのみ）
        </button>
      </div>
    </div>
  ) : null

  // Whether notes area is empty (show hint card)
  const notesEmpty = activeNote.blocks.every(b => !b.content.trim())

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

      {WelcomeScreen}

      {/* Mobile-only compact header */}
      <div className="hidden max-[700px]:flex flex-col flex-shrink-0"
        style={{ background: 'var(--deck)', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <div className="flex items-center gap-2 px-3 py-2">
          <button className={hbtn()} onClick={() => setMobNoteList(true)} title="ノート一覧" style={{ fontSize: 16, padding: '2px 8px' }}>≡</button>
          <input className={`${miBase} flex-1 min-w-0 font-bold text-sm`} style={{ fontFamily: 'inherit' }}
            placeholder="科目名" value={activeNote.subject}
            onChange={e => updateNote({ subject: e.target.value })} />
          <input className={`${miBase} w-14 flex-shrink-0 text-center text-sm`} style={{ fontFamily: 'IBM Plex Mono, monospace' }}
            placeholder="第?" value={activeNote.session}
            onChange={e => updateNote({ session: e.target.value })} />
          <button className={hbtn(reviewMode)} onClick={toggleReview} title="復習モード" style={{ fontSize: 12 }}>復習</button>
          <button className={hbtn(showAI)} onClick={() => { setShowAI(p => !p); setShareUrl('') }} title="AI解説" style={{ fontSize: 12 }}>AI</button>
        </div>
        <div className="px-3 pb-1">
          <input className={`${miBase} w-full text-sm`} style={{ fontFamily: 'inherit' }}
            placeholder="今日のテーマ" value={activeNote.topic}
            onChange={e => updateNote({ topic: e.target.value })} />
        </div>
      </div>

      {/* Mobile note list bottom sheet */}
      {mobNoteList && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,.55)' }}
          onClick={() => setMobNoteList(false)}>
          <div style={{ background: 'var(--surf)', borderRadius: '16px 16px 0 0', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid var(--edge)' }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>ノート一覧</span>
              <button style={{ background: 'var(--acc)', border: 'none', borderRadius: 8, color: '#fff', fontFamily: 'Noto Sans JP, sans-serif', fontSize: 13, fontWeight: 700, padding: '6px 14px', cursor: 'pointer' }}
                onClick={() => { newNote(); setMobNoteList(false) }}>+ 新規</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {notes.map(n => (
                <div key={n.id}
                  style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--edge)', background: n.id === activeId ? 'var(--acc-dim)' : 'transparent', cursor: 'pointer' }}
                  onClick={() => { switchNote(n.id); setMobNoteList(false) }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{noteTitle(n) || '無題'}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 2 }}>{n.date}</div>
                  </div>
                  {n.id === activeId && <span style={{ fontSize: 11, color: 'var(--acc)', marginRight: 8, fontWeight: 700 }}>表示中</span>}
                  <button
                    onClick={e => { e.stopPropagation(); deleteNote(n.id); if (notes.length <= 1) setMobNoteList(false) }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--fg3)', fontSize: 18, cursor: 'pointer', padding: '4px 6px', borderRadius: 6, flexShrink: 0 }}
                    onTouchStart={e => (e.currentTarget.style.color = '#b01818')}
                    onTouchEnd={e => (e.currentTarget.style.color = 'var(--fg3)')}>×</button>
                </div>
              ))}
            </div>
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--edge)' }}>
              {user ? (
                <div style={{ fontSize: 11, color: 'var(--fg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>☁ {user.email}</span>
                  <button onClick={() => supabase.auth.signOut()} style={{ background: 'transparent', border: '1px solid var(--edge)', borderRadius: 6, color: 'var(--fg3)', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>ログアウト</button>
                </div>
              ) : (
                <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })}
                  style={{ width: '100%', background: 'rgba(66,133,244,.1)', border: '1px solid rgba(66,133,244,.35)', borderRadius: 8, color: '#7ca8ff', fontSize: 13, padding: '8px', cursor: 'pointer' }}>
                  G · Googleでログイン / 同期
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{ background: 'var(--deck)', borderBottom: '1px solid rgba(255,255,255,.05)' }}
        className="max-[700px]:hidden flex items-center gap-2 flex-shrink-0 px-4 py-2">
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
          <button className={hbtn(showAI)} onClick={() => { setShowAI(p => !p); setShareUrl('') }} title="AIに解説してもらう">AI解説</button>
          <button className={hbtn()} onClick={shareNote} disabled={shareLoading} title="ノートを共有する">
            {shareLoading ? '...' : shareUrl ? '✓ リンクをコピー済み' : '🔗 共有'}
          </button>
          <button className={hbtn()} onClick={openExport} title="エクスポート">⬇</button>
          <button className={hbtn()} onClick={() => setShowHelp(true)} title="ヘルプ Ctrl+/">?</button>
        </div>
      </header>

      {/* Legend — clickable to change the focused block's type */}
      <div style={{ background: 'var(--surf)', borderBottom: '1px solid var(--edge)', fontFamily: "'IBM Plex Mono', monospace", color: 'var(--fg3)' }}
        className="max-[700px]:hidden flex gap-1 flex-shrink-0 px-3 py-1 overflow-x-auto whitespace-nowrap text-[10px]">
        {([
          ['> ',  '重要', 'var(--c-imp)', 'var(--c-imp-bg)'],
          ['? ',  '疑問', 'var(--c-q)',   'var(--c-q-bg)'],
          ['! ',  '試験', 'var(--c-ex)',  'var(--c-ex-bg)'],
          ['=> ', '因果', 'var(--c-ca)',  'var(--c-ca-bg)'],
          ['~ ',  '感想', 'var(--c-rx)',  'var(--c-rx-bg)'],
          ['- ',  'メモ', 'var(--fg3)',   'transparent'],
        ] as [string, string, string, string][]).map(([prefix, label, color, bg]) => (
          <button
            key={prefix}
            onClick={() => insertPrefix(prefix)}
            title={`${label}ブロックに変更 — Ctrl+Shift+${['> ','? ','! ','=> ','~ ','- '].indexOf(prefix)+1}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: bg, border: `1px solid ${color}`,
              borderRadius: 4, padding: '2px 7px', cursor: 'pointer',
              fontFamily: 'IBM Plex Mono, monospace', fontSize: 10,
              color: color, transition: 'opacity .12s',
              opacity: 0.7,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7' }}
          >
            <code style={{ color: 'inherit' }}>{prefix.trim()}</code>
            <span>{label}</span>
          </button>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--fg3)', fontSize: 9, display: 'flex', alignItems: 'center', gap: 3 }}>
          <kbd style={{ background: 'var(--edge)', borderRadius: 3, padding: '1px 4px', fontSize: 9 }}>/</kbd> でも選べる
        </span>
      </div>

      {/* Mobile tabs */}
      <div className="hidden max-[700px]:flex" style={{ background: 'var(--deck)', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
        {([['notes', 'ノート'], ['cue', 'キュー'], ['summary', 'まとめ']] as const).map(([tab, label]) => (
          <button key={tab} onClick={() => setMobPanel(tab)}
            style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `2px solid ${mobPanel === tab ? 'var(--acc)' : 'transparent'}`,
              color: mobPanel === tab ? '#fff' : 'rgba(255,255,255,.45)', cursor: 'pointer',
              fontFamily: 'Noto Sans JP, sans-serif', fontSize: 13, padding: '10px 4px',
              fontWeight: mobPanel === tab ? 700 : 400 }}>
            {label}
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
              <div key={n.id} onClick={() => { switchNote(n.id); setReviewMode(false) }}
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
          {/* Auth section */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', padding: '10px 12px', flexShrink: 0 }}>
            {user ? (
              <>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ☁ {user.email}
                </div>
                <button
                  onClick={() => supabase.auth.signOut()}
                  style={{ width: '100%', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 5, color: 'rgba(255,255,255,.55)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, padding: '5px 8px', cursor: 'pointer' }}
                >ログアウト</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginBottom: 6 }}>
                  複数デバイスで同期する
                </div>
                <button
                  onClick={() => supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: { redirectTo: window.location.origin },
                  })}
                  style={{ width: '100%', background: 'rgba(66,133,244,.12)', border: '1px solid rgba(66,133,244,.35)', borderRadius: 5, color: '#7ca8ff', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, padding: '5px 8px', cursor: 'pointer' }}
                >G · Googleでログイン</button>
              </>
            )}
          </div>
        </aside>

        {/* Cornell content */}
        <div className="flex flex-col flex-1 overflow-hidden min-h-0 max-[700px]:relative">
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
              {/* Structured Cornell Q&A */}
              <div ref={cueRef} className="flex-1 overflow-y-auto">
                {([
                  '定義・概念は何か？',
                  'なぜ・どのように起きるのか？',
                  '具体的な例は？',
                  '他の概念・以前の内容との違いは？',
                  '試験で問われそうな点は？',
                ] as const).map((q, i) => {
                  let answers: string[] = []
                  try { answers = JSON.parse(activeNote.cue) } catch {}
                  if (!Array.isArray(answers)) answers = []
                  const val = answers[i] ?? ''
                  return (
                    <div key={i} style={{ borderBottom: '1px solid var(--edge)', padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, color: 'var(--acc)', fontFamily: 'IBM Plex Mono, monospace', marginBottom: 5, display: 'flex', gap: 5, alignItems: 'center' }}>
                        <span style={{ opacity: 0.6 }}>{i + 1}.</span>
                        <span style={{ color: 'var(--fg2)', fontFamily: 'inherit', fontSize: 11 }}>{q}</span>
                      </div>
                      <textarea
                        rows={2}
                        className="w-full resize-none outline-none text-[12px] leading-[1.7]"
                        style={{ background: 'rgba(47,82,212,0.04)', border: '1px solid var(--edge)', borderRadius: 5, padding: '5px 8px', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--fg)', caretColor: 'var(--acc)', width: '100%', boxSizing: 'border-box' }}
                        placeholder="ここに答えを書く"
                        value={val}
                        onChange={e => {
                          let cur: string[] = []
                          try { cur = JSON.parse(activeNote.cue) } catch {}
                          if (!Array.isArray(cur)) cur = []
                          const next = [...cur]
                          next[i] = e.target.value
                          updateNote({ cue: JSON.stringify(next) })
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Tab') { e.preventDefault(); document.querySelector<HTMLElement>('.block-line')?.focus() }
                        }}
                      />
                    </div>
                  )
                })}
              </div>
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

              {/* Empty state hint card */}
              {notesEmpty && !reviewMode && (
                <div style={{ margin: '14px 14px 0', padding: '14px 16px', borderRadius: 10, border: '1px dashed var(--edge)', background: 'rgba(47,82,212,0.03)', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--fg2)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>何を書きますか？　クリックして始める、または</span>
                    <kbd style={{ background: 'var(--edge)', borderRadius: 4, padding: '1px 6px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 }}>/</kbd>
                    <span>で選ぶ</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {SLASH_CMDS.map(cmd => (
                      <button
                        key={cmd.prefix}
                        onClick={() => insertPrefix(cmd.prefix)}
                        style={{
                          background: 'transparent',
                          border: `1px solid var(--edge)`,
                          borderRadius: 7,
                          padding: '8px 10px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'border-color .12s, background .12s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = cmd.color; (e.currentTarget as HTMLElement).style.background = 'rgba(47,82,212,0.04)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--edge)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        <div style={{ color: cmd.color, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, marginBottom: 3 }}>{cmd.prefix.trim()}</div>
                        <div style={{ fontSize: 12, color: 'var(--fg)', fontWeight: 500 }}>{cmd.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--fg3)', marginTop: 1 }}>{cmd.hint}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <BlockEditor
                blocks={activeNote.blocks}
                onUpdate={blocks => updateNote({ blocks })}
                reviewMode={reviewMode}
                tabNext={() => sumRef.current?.focus()}
                tabPrev={() => cueRef.current?.focus()}
              />
              {/* Mobile action bar */}
              <div className="hidden max-[700px]:flex gap-0 flex-shrink-0"
                style={{ background: 'var(--deck)', borderTop: '1px solid rgba(255,255,255,.08)' }}>
                {([
                  ['> ', '重要', 'var(--c-imp)', 'rgba(47,82,212,.15)'],
                  ['? ', '疑問', 'var(--c-q)', 'rgba(192,104,0,.12)'],
                  ['! ', '試験', 'var(--c-ex)', 'rgba(176,24,24,.12)'],
                  ['=> ', '因果', 'var(--c-ca)', 'rgba(6,132,90,.12)'],
                  ['~ ', '感想', 'var(--c-rx)', 'rgba(124,58,237,.12)'],
                  ['- ', 'メモ', 'rgba(255,255,255,.5)', 'transparent'],
                ] as [string, string, string, string][]).map(([p, label, col, bg]) => (
                  <button key={p} onClick={() => insertPrefix(p)}
                    style={{ flex: 1, background: bg, border: 'none', borderRight: '1px solid rgba(255,255,255,.06)', color: col, fontFamily: 'Noto Sans JP, sans-serif', fontSize: 11, padding: '10px 2px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                    <span style={{ fontWeight: 700 }}>{label}</span>
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* Summary */}
          <div className={`panel-wrap flex flex-col flex-shrink-0
            max-[700px]:absolute max-[700px]:inset-0 max-[700px]:z-10 max-[700px]:transition-opacity
            ${mobPanel === 'summary' ? 'max-[700px]:opacity-100 max-[700px]:pointer-events-auto' : 'max-[700px]:opacity-0 max-[700px]:pointer-events-none'}`}
            style={{ background: 'var(--surf)', borderTop: '1px solid var(--edge)' }}>
            <div className="flex items-center justify-between flex-shrink-0 px-3 py-1.5"
              style={{ borderBottom: '1px solid var(--edge)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--fg3)' }}>
              <span>まとめ</span>
              <span className="pact text-[9px] px-1 rounded border opacity-0 transition-opacity"
                style={{ background: 'var(--acc-dim)', borderColor: 'var(--acc)', color: 'var(--acc)' }}>ACTIVE</span>
            </div>
            <textarea ref={sumRef} className="w-full resize-none outline-none px-3 py-2 text-[13px] leading-[1.75] max-[700px]:flex-1"
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
      <div className="max-[700px]:hidden flex items-center gap-3 flex-shrink-0 px-4 py-1 overflow-x-auto whitespace-nowrap"
        style={{ background: 'var(--deck)', borderTop: '1px solid rgba(255,255,255,.04)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
        {[['Tab', 'インデント'], ['Shift+Tab', 'アウトデント'], ['Ctrl+1/2/3', 'パネル移動'], ['Ctrl+R', '復習'], ['Ctrl+/', 'ヘルプ']].map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <kbd style={{ background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 3, padding: '0 4px', fontSize: 9, color: 'rgba(255,255,255,.6)' }}>{k}</kbd>
            {v}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: savedFlash ? '#5ac87a' : 'transparent', transition: 'color .4s' }}>✓ 保存済み</span>
        {syncing && <span style={{ color: 'rgba(66,133,244,.8)' }}>⟳ 同期中</span>}
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
              ['パネル移動', [['Ctrl+1', 'キュー欄'], ['Ctrl+2', 'ノート欄'], ['Ctrl+3', 'まとめ欄'], ['空行でTab', '次のパネルへ移動'], ['空行でShift+Tab', '前のパネルへ移動']]],
              ['アプリ操作', [['Ctrl+R', '復習モード（重要ブロックをマスク）'], ['Ctrl+S', '手動保存'], ['Ctrl+N', '新規ノート'], ['Ctrl+B', 'サイドバー開閉'], ['Ctrl+/', 'ヘルプ'], ['Escape', '閉じる/終了']]],
              ['ブロック種類の変更', [['凡例ボタンをクリック', '現在のブロックの種類を変更'], ['Ctrl+Shift+1', '重要・定義に変更'], ['Ctrl+Shift+2', '疑問点に変更'], ['Ctrl+Shift+3', '試験ポイントに変更'], ['Ctrl+Shift+4', '因果関係に変更'], ['Ctrl+Shift+5', '感想・リアクションに変更'], ['Ctrl+Shift+6', '通常メモに変更']]],
              ['ブロック入力・構造', [['/', '行頭で入力 → ブロック種類ピッカー'], ['1〜6キー', 'ピッカー開中に種類を素早く選ぶ'], ['Tab', 'ブロックをインデント（段落下げ）'], ['Shift+Tab', 'インデントを戻す'], ['+ テンプレ', 'キュー欄にコーネル式質問テンプレを挿入']]],
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

      {/* AI explain panel */}
      {showAI && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" style={{ background: 'rgba(0,0,0,.72)' }}
          onClick={() => setShowAI(false)}>
          <div className="rounded-xl w-full max-w-sm flex flex-col overflow-hidden"
            style={{ background: 'var(--surf)', border: '1px solid var(--edge)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--edge)' }}>
              <span className="font-bold text-[14px]">AIに解説してもらう</span>
              <button onClick={() => setShowAI(false)} style={{ background: 'transparent', border: 'none', color: 'var(--fg3)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div style={{ fontSize: 13, color: 'var(--fg2)', lineHeight: 1.8 }}>
                ノートの内容をコピーして、お使いのAIに貼り付けてください。
              </div>

              {/* Step 1 */}
              <button
                onClick={copyForAI}
                className="w-full py-3 rounded-lg text-[14px] font-bold cursor-pointer transition-colors"
                style={{
                  background: aiCopied ? 'rgba(90,200,122,.15)' : 'var(--acc-dim)',
                  border: `1px solid ${aiCopied ? '#5ac87a' : 'var(--acc)'}`,
                  color: aiCopied ? '#5ac87a' : 'var(--acc)',
                }}>
                {aiCopied ? '① コピーしました ✓' : '① ノートをコピーする'}
              </button>

              {/* Step 2 */}
              <div style={{ fontSize: 11, color: 'var(--fg3)', textAlign: 'center' }}>↓ 好きなAIを開いて貼り付け（Ctrl+V）</div>
              <div className="flex flex-col gap-2">
                <a href="https://chat.openai.com" target="_blank" rel="noreferrer"
                  className="py-2.5 rounded-lg text-[13px] font-bold text-center cursor-pointer"
                  style={{ background: 'rgba(16,163,127,.1)', border: '1px solid rgba(16,163,127,.4)', color: '#10a37f', textDecoration: 'none' }}>
                  ChatGPT で開く
                </a>
                <a href="https://gemini.google.com" target="_blank" rel="noreferrer"
                  className="py-2.5 rounded-lg text-[13px] font-bold text-center cursor-pointer"
                  style={{ background: 'rgba(66,133,244,.1)', border: '1px solid rgba(66,133,244,.4)', color: '#4285f4', textDecoration: 'none' }}>
                  Gemini で開く
                </a>
                <a href="https://claude.ai" target="_blank" rel="noreferrer"
                  className="py-2.5 rounded-lg text-[13px] font-bold text-center cursor-pointer"
                  style={{ background: 'rgba(217,119,6,.08)', border: '1px solid rgba(217,119,6,.3)', color: '#f59e0b', textDecoration: 'none' }}>
                  Claude で開く
                </a>
              </div>
            </div>
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
