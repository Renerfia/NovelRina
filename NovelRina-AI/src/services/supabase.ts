import { createClient } from '@supabase/supabase-js'
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { ref } from 'vue'

type NovelRow = {
  novel_id: string
  novel_name: string
  description: string | null
  author_id: string
}

type ChapterRow = {
  chapter_id: string
  novel_id: string
  chapter_name: string
  chapter_content: string
  chapter_content_summary: string | null
  chapter_content_embedding: number[] | null
}

interface Database {
  public: {
    Tables: {
      novels: {
        Row: NovelRow
        Insert: {
          novel_id?: string
          novel_name: string
          description?: string | null
          author_id: string
        }
        Update: {
          novel_name?: string
          description?: string | null
        }
        Relationships: []
      }
      chapters: {
        Row: ChapterRow
        Insert: {
          chapter_id?: string
          novel_id: string
          chapter_name: string
          chapter_content: string
          chapter_content_summary?: string | null
          chapter_content_embedding?: number[] | null
        }
        Update: {
          chapter_name?: string
          chapter_content?: string
          chapter_content_summary?: string | null
          chapter_content_embedding?: number[] | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      match_chapters_novelrina: {
        Args: {
          query_embedding: number[]
          match_count: number
          filter_novel_id: string
          filter_user_id: string
        }
        Returns: Array<{
          chapter_id: string
          chapter_content: string
          similarity: number
        }>
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLIC_KEY

export const supabaseConfigError =
  supabaseUrl && supabaseKey
    ? null
    : 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to connect NovelRina to Supabase.'

export const supabase: SupabaseClient<Database> | null =
  supabaseUrl && supabaseKey
    ? createClient<Database>(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      })
    : null

export const session = ref<Session | null>(null)
export const user = ref<User | null>(null)
export const authReady = ref(false)
export const authError = ref('')

let authListenerStarted = false

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError ?? 'Supabase is not configured.')
  }
  return supabase
}

export async function initializeAuth() {
  authError.value = ''
  try {
    const client = requireSupabase()
    if (!authListenerStarted) {
      authListenerStarted = true
      client.auth.onAuthStateChange((_event, currentSession) => {
        session.value = currentSession
        user.value = currentSession?.user ?? null
      })
    }

    const { data, error } = await client.auth.getSession()
    if (error) throw error
    session.value = data.session
    user.value = data.session?.user ?? null
  } catch (error) {
    authError.value =
      error instanceof Error ? error.message : 'Could not connect to Supabase authentication.'
  } finally {
    authReady.value = true
  }
}

export async function signIn(email: string, password: string) {
  const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password })
  if (error) throw error
  session.value = data.session
  user.value = data.user
}

export async function signUp(email: string, password: string) {
  const { data, error } = await requireSupabase().auth.signUp({ email, password })
  if (error) throw error
  session.value = data.session
  user.value = data.session?.user ?? null
  return Boolean(data.session)
}

export async function signOut() {
  const { error } = await requireSupabase().auth.signOut()
  if (error) throw error
  session.value = null
  user.value = null
}

export async function updateDisplayName(name: string) {
  const { data, error } = await requireSupabase().auth.updateUser({
    data: { display_name: name },
  })
  if (error) throw error
  user.value = data.user
  session.value = session.value ? { ...session.value, user: data.user } : null
}
