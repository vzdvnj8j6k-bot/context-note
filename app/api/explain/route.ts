import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'edge'

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return new Response('AI機能が設定されていません', { status: 503 })

  const { noteText } = await req.json()
  if (!noteText) return new Response('noteText required', { status: 400 })

  const client = new Anthropic({ apiKey })

  const prompt = `あなたは優秀な家庭教師です。以下の授業ノートを読んで、ノートを取るのが苦手な学生が理解しやすいように解説してください。

${noteText}

以下の形式で答えてください：

## 🎯 このノートの核心
（このトピックで一番大事な1〜2文）

## 📌 重要ポイント整理
（箇条書きで3〜5つ、難しい言葉は分かりやすく言い換える）

## 💡 もっと分かりやすく説明すると
（具体例や身近なたとえを使って概念を説明する）

## ❓ 試験に出そうな問いと答え
（2〜3つのQ&A形式）`

  const stream = await client.messages.stream({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          controller.enqueue(encoder.encode(chunk.delta.text))
        }
      }
      controller.close()
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
