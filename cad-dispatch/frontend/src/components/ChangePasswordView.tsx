import { FormEvent, useState } from 'react';
import { KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const inputClass =
  'w-full rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 ' +
  'placeholder:text-slate-500 outline-none focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/40';

const labelClass = 'mb-1 block text-xs uppercase tracking-[0.2em] text-slate-400';

interface Props {
  /** Forced mode is shown full-screen after a reset and cannot be dismissed. */
  forced?: boolean;
  onDone?: () => void;
}

export function ChangePasswordView({ forced = false, onDone }: Props) {
  const { changePassword, logout, user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to change your password.');
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && !forced && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          Password updated.
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="cp-current">
          {forced ? 'Temporary password' : 'Current password'}
        </label>
        <input
          id="cp-current"
          type="password"
          className={inputClass}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="cp-new">New password</label>
        <input
          id="cp-new"
          type="password"
          className={inputClass}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <p className="mt-1 text-xs text-slate-500">At least 10 characters, and not your username.</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="cp-confirm">Confirm new password</label>
        <input
          id="cp-confirm"
          type="password"
          className={inputClass}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500/25 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/35 disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Update password
      </button>
    </form>
  );

  if (!forced) {
    return (
      <div className="panel-glass rounded-3xl p-5">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-cyan-300" />
          <div>
            <p className="text-sm font-medium text-cyan-300">Change your password</p>
            <p className="text-xs text-slate-400">Signed in as {user?.username}</p>
          </div>
        </div>
        <div className="max-w-md">{form}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10 text-slate-100">
      <div className="w-full max-w-md">
        <div className="panel-glass rounded-3xl p-6 shadow-neon">
          <div className="mb-5 text-center">
            <KeyRound className="mx-auto h-9 w-9 text-cyan-300" />
            <h1 className="mt-3 text-lg font-semibold text-white">Set a new password</h1>
            <p className="mt-2 text-sm text-slate-300">
              Your account uses a password that was generated for you. Choose your own before continuing.
            </p>
          </div>

          {form}

          <button
            type="button"
            onClick={logout}
            className="mt-4 w-full rounded-xl px-4 py-2 text-xs text-slate-400 hover:text-slate-200"
          >
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
