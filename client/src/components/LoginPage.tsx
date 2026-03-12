import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { login, register, setToken } from '../lib/auth';

interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = isRegister
        ? await register(username, password)
        : await login(username, password);

      if (result.ok && result.token) {
        setToken(result.token);
        onLogin();
      } else {
        setError(result.error || 'Authentication failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg p-8" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>BAREclaw</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {isRegister ? 'Create an account' : 'Sign in to continue'}
        </p>

        {error && (
          <div className="rounded p-2 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>
            {error}
          </div>
        )}

        <Input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button type="submit" className="w-full" disabled={loading || !username || !password}>
          {loading ? '...' : isRegister ? 'Register' : 'Sign in'}
        </Button>

        <button
          type="button"
          className="w-full text-sm underline"
          style={{ color: 'var(--text-secondary)' }}
          onClick={() => { setIsRegister(!isRegister); setError(''); }}
        >
          {isRegister ? 'Already have an account? Sign in' : 'Need an account? Register'}
        </button>
      </form>
    </div>
  );
}
