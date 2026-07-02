import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null; session: Session | null }>
  signUp: (email: string, password: string) => Promise<{ error: Error | null; session: Session | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Preview-only auth shim. Never enable in production builds.
const PREVIEW_BYPASS =
  import.meta.env.VITE_PREVIEW_AUTH_BYPASS === 'true' && import.meta.env.DEV

const PREVIEW_FAKE_USER = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'preview@local',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: new Date().toISOString(),
} as unknown as User

const PREVIEW_FAKE_SESSION = {
  access_token: 'preview-token',
  refresh_token: 'preview-refresh',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: PREVIEW_FAKE_USER,
} as unknown as Session

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(PREVIEW_BYPASS ? PREVIEW_FAKE_USER : null)
  const [session, setSession] = useState<Session | null>(PREVIEW_BYPASS ? PREVIEW_FAKE_SESSION : null)
  const [loading, setLoading] = useState(!PREVIEW_BYPASS)

  useEffect(() => {
    if (PREVIEW_BYPASS) return // keep fake user, skip real auth bootstrap

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error as Error | null, session: data.session }
  }

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    return { error: error as Error | null, session: data.session }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
