export type BlockType = 'normal' | 'important' | 'question' | 'exam' | 'cause' | 'reaction'

export interface Block {
  id: string
  type: BlockType
  content: string
}

export interface Note {
  id: string
  subject: string
  topic: string
  session: string
  date: string
  cue: string
  summary: string
  blocks: Block[]
  created: number
  updated: number
}
