// src/lib/supabase-server.ts  (ou src/app/lib/supabase-server.ts)
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function supabaseServer() {
  // Next.js 15: cookies() é assíncrono
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // lido pelo @supabase/ssr para restaurar a sessão
        getAll() {
          return cookieStore.getAll()
        },
        // chamado quando o Supabase precisar atualizar cookies (ex.: refresh token)
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Se for chamado dentro de um Server Component puro, "set" não é permitido.
            // Em Server Actions/Route Handlers funciona normalmente.
          }
        },
      },
    }
  )
}
