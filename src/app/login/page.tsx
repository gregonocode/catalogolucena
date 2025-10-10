'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function LoginPage() {
  const supabase = supabaseBrowser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast.error(
        error.message.includes('Invalid login')
          ? 'E-mail ou senha incorretos.'
          : `Erro ao entrar: ${error.message}`
      );
      setLoading(false);
      return;
    }

    toast.success('Bem-vindo(a) 👋');
    window.location.href = '/dasboard'; // mantém o typo que você usa
  }

  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-2 bg-white">
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: '#F0FFF4',
            color: '#15803D',
            border: '1px solid #BBF7D0',
            borderRadius: '8px',
          },
        }}
      />

      {/* Branding - ESQUERDA no desktop, abaixo no mobile */}
      <section
        className="
          flex items-center justify-center p-8 text-white
          order-2 md:order-1
          md:col-start-1 md:col-end-2
        "
        style={{ backgroundColor: '#01A920' }}
      >
        <div className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tight">Lucena Modas</h2>
          <p className="mt-3 text-lg opacity-90">Gerencie seu Catálogo</p>
        </div>
      </section>

      {/* Login - DIREITA no desktop, primeiro no mobile */}
      <section
        className="
          flex items-center justify-center p-6 md:p-10
          order-1 md:order-2
          md:col-start-2 md:col-end-3
        "
      >
        <div className="w-full max-w-sm">
          <h1 className="mb-2 text-2xl font-semibold">Entrar</h1>
          <p className="mb-6 text-sm text-gray-600">
            Use seu e-mail e senha para acessar a dashboard.
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                E-mail
              </label>
              <input
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 p-2 text-base focus:outline-none focus:ring-2 focus:ring-[#01A920]"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Senha
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-gray-300 p-2 pr-10 text-base focus:outline-none focus:ring-2 focus:ring-[#01A920]"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:opacity-80"
                >
                  {showPw ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-[#01A920] p-2 font-semibold text-white transition-all hover:opacity-95 active:translate-y-[1px] disabled:opacity-60"
            >
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
