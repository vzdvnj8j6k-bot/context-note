import { Note } from './types'

const KEY = 'ctx-notes-v3'

export function loadStore(): { notes: Note[]; activeId: string | null } {
  if (typeof window === 'undefined') return { notes: [], activeId: null }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { notes: [], activeId: null }
    return JSON.parse(raw)
  } catch {
    return { notes: [], activeId: null }
  }
}

export function saveStore(notes: Note[], activeId: string | null) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify({ notes, activeId }))
  } catch {}
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}
