import { FormEvent, useEffect, useState } from 'react';
import { CircleCheck, Loader2, Lock, ShieldAlert, UserPlus } from 'lucide-react';
import { apiRequest, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

type Mode = 'login' | 'register' | 'forgot';

const inputClass =
  'w-full rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 ' +
  'placeholder:text-slate-500 outline-none focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/40';

const labelClass = 'mb-1 block text-xs uppercase tracking-[0.2em] text-slate-400';

export function LoginView() {
  const { login } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [departments, setDepartments] = useState<string[]>([]);
  const [selfRegistration, setSelfRegistration] = useState(true);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('Police');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [note, setNote] = useState('');

  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<{ departments: string[]; selfRegistration: boolean }>('/api/auth/departments')
      .then((data) => {
        setDepartments(data.departments);
        setSelfRegistration(data.selfRegistration);
        if (data.departments[0]) setDepartment(data.departments[0]);
      })
      .catch(() => setDepartments(['Police', 'Sheriff', 'Fire Rescue', 'EMS', 'Dispatch']));
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setSubmitted(false);
    setNotice(null);
  };

  const handleForgot = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await apiRequest<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: { identifier },
        allowUnauthorized: true,
      });
      setNotice(data.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to request a reset.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await apiRequest('/api/auth/register', {
        method: 'POST',
        body: { username, fullName, email, department, password, note },
        allowUnauthorized: true,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit your request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10 text-slate-100">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Emergency Communications Center</p>
          <h1 className="mt-2 text-2xl font-bold text-white">Dispatch Command &amp; MDT Suite</h1>
        </div>

        <div className="panel-glass rounded-3xl p-6 shadow-neon">
          {submitted ? (
            <div className="text-center">
              <CircleCheck className="mx-auto h-10 w-10 text-emerald-400" />
              <h2 className="mt-3 text-lg font-semibold text-white">Request submitted</h2>
              <p className="mt-2 text-sm text-slate-300">
                Your account is awaiting administrator approval. You will be able to sign in with the
                username and password you just chose once it is approved.
              </p>
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="mt-5 w-full rounded-xl bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/30"
              >
                Back to sign in
              </button>
            </div>
          ) : mode === 'forgot' ? (
            <div>
              <h2 className="text-lg font-semibold text-white">Reset your password</h2>
              <p className="mt-2 text-sm text-slate-300">
                Enter your username or the email address on your account. We will email you a
                temporary password that you can sign in with straight away.
              </p>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {notice ? (
                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200">
                  {notice}
                </div>
              ) : (
                <form onSubmit={handleForgot} className="mt-4 space-y-4">
                  <div>
                    <label className={labelClass} htmlFor="forgot-identifier">Username or email</label>
                    <input
                      id="forgot-identifier"
                      className={inputClass}
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      autoComplete="username"
                      autoFocus
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500/25 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/35 disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Email me a temporary password
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => switchMode('login')}
                className="mt-4 w-full rounded-xl px-4 py-2 text-xs text-slate-400 hover:text-slate-200"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-950/60 p-1">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    mode === 'login' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Lock className="h-4 w-4" /> Sign in
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  disabled={!selfRegistration}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    mode === 'register' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <UserPlus className="h-4 w-4" /> Request access
                </button>
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {mode === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className={labelClass} htmlFor="login-username">Username</label>
                    <input
                      id="login-username"
                      className={inputClass}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      autoFocus
                      required
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="login-password">Password</label>
                    <input
                      id="login-password"
                      type="password"
                      className={inputClass}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500/25 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/35 disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Sign in
                  </button>

                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="w-full rounded-xl px-4 py-1 text-xs text-slate-400 hover:text-cyan-200"
                  >
                    Forgot your password?
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <label className={labelClass} htmlFor="reg-fullname">Full name</label>
                    <input
                      id="reg-fullname"
                      className={inputClass}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="reg-username">Username</label>
                    <input
                      id="reg-username"
                      className={inputClass}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="reg-email">Email</label>
                    <input
                      id="reg-email"
                      type="email"
                      className={inputClass}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Used to reset your password if you forget it.
                    </p>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="reg-department">Department</label>
                    <select
                      id="reg-department"
                      className={inputClass}
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    >
                      {departments.map((entry) => (
                        <option key={entry} value={entry}>{entry}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="reg-password">Password</label>
                    <input
                      id="reg-password"
                      type="password"
                      className={inputClass}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <p className="mt-1 text-xs text-slate-500">At least 10 characters.</p>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="reg-confirm">Confirm password</label>
                    <input
                      id="reg-confirm"
                      type="password"
                      className={inputClass}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="reg-note">Note for the admin <span className="text-slate-600">(optional)</span></label>
                    <input
                      id="reg-note"
                      className={inputClass}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="In-game name, referral, etc."
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500/25 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/35 disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Submit access request
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
