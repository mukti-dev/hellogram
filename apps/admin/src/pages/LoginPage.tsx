import { Button, Card, Logo, TextField } from '@hellogram/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { adminApi, session } from '../api.js';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4 text-fg">
      <Card className="w-full max-w-sm p-6">
        <Logo />
        <h1 className="mt-4 text-xl font-bold">Admin sign in</h1>
        <p className="text-sm text-muted">Email, password and your authenticator code.</p>
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const { token } = await adminApi<{ token: string }>('/auth/login', { method: 'POST', body: { email, password, code } });
              session.set(token);
              navigate('/', { replace: true });
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Sign-in failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <TextField label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <Button type="submit" variant="gradient" fullWidth disabled={busy}>
            Sign in
          </Button>
        </form>
      </Card>
    </main>
  );
}
