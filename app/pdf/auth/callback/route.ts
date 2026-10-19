import { NextRequest, NextResponse } from 'next/server'
import { getPdfSupabaseClient } from '@/lib/pdf-supabase'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const sb = getPdfSupabaseClient()
    await sb.auth.exchangeCodeForSession(code)
  }

  return NextResponse.redirect(`${origin}/pdf`)
}
