import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  const { token, documentId, pageNumber, annotations } = body
  if (!token || !documentId || pageNumber == null || !annotations) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY が .env.local に設定されていません' },
      { status: 500 }
    )
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: link } = await admin
    .from('collab_links')
    .select('document_id')
    .eq('token', token)
    .eq('document_id', documentId)
    .single()

  if (!link) {
    return Response.json({ error: 'Invalid collab token' }, { status: 403 })
  }

  const { error } = await admin
    .from('annotations')
    .upsert(
      {
        document_id: documentId,
        page_number: pageNumber,
        strokes: {
          strokes: annotations.strokes ?? [],
          texts: annotations.texts ?? [],
          eraserMarks: annotations.eraserMarks ?? [],
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'document_id,page_number' }
    )

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
