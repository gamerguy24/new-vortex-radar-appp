import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, ClipboardCopy, KeyRound, Loader2, Pause, Play, RefreshCw,
  ShieldAlert, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import { apiRequest, ApiError } from '../api/client';
import { SessionUser, useAuth } from '../auth/AuthContext';

interface UsersResponse {
  users: SessionUser[];
  roles: string[];
  departments: string[];
  pendingCount: number;
}

interface Analytics {
  activeCalls: number;
  activeUnits: number;
  totalUsers: number;
  pendingApprovals: number;
  suspendedUsers: number;
  admins: number;
}

interface AuditEntry {
  id: string;
  actorName: string;
  action: string;
  targetName: string | null;
  detail: string;
  createdAt: string;
}

/** A generated password, held in memory only until the admin dismisses it. */
interface Credential {
  username: string;
  fullName: string;
  password: string;
  context: 'created' | 'reset';
  /** True when the server also emailed it to the user's address on file. */
  emailed: boolean;
}

const inputClass =
  'w-full rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 ' +
  'placeholder:text-slate-500 outline-none focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/40';

const labelClass = 'mb-1 block text-xs uppercase tracking-[0.2em] text-slate-400';

const statusStyles: Record<string, string> = {
  active: 'bg-emerald-500/20 text-emerald-200',
  pending: 'bg-amber-500/20 text-amber-200',
  suspended: 'bg-slate-500/20 text-slate-300',
  denied: 'bg-red-500/20 text-red-200',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function AdminPortal() {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState<SessionUser[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [credential, setCredential] = useState<Credential | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [usersData, analyticsData, auditData] = await Promise.all([
        apiRequest<UsersResponse>('/api/admin/users'),
        apiRequest<Analytics>('/api/admin/analytics'),
        apiRequest<{ logs: AuditEntry[] }>('/api/admin/audit?limit=40'),
      ]);
      setUsers(usersData.users);
      setRoles(usersData.roles);
      setDepartments(usersData.departments);
      setAnalytics(analyticsData);
      setAudit(auditData.logs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load the admin portal.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runAction = useCallback(async (
    id: string,
    request: () => Promise<unknown>,
  ) => {
    setBusyId(id);
    setError(null);
    try {
      await request();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That action failed.');
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const pending = useMemo(() => users.filter((u) => u.status === 'pending'), [users]);
  const roster = useMemo(() => users.filter((u) => u.status !== 'pending'), [users]);

  const handleResetPassword = (target: SessionUser) => runAction(target.id, async () => {
    const data = await apiRequest<{ tempPassword: string; emailed: boolean }>(
      `/api/admin/users/${target.id}/reset-password`,
      { method: 'POST' },
    );
    setCredential({
      username: target.username,
      fullName: target.fullName,
      password: data.tempPassword,
      context: 'reset',
      emailed: data.emailed,
    });
  });

  const handleDelete = (target: SessionUser) => {
    if (!window.confirm(`Permanently delete the account for ${target.fullName} (${target.username})?`)) return;
    return runAction(target.id, () => apiRequest(`/api/admin/users/${target.id}`, { method: 'DELETE' }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading admin portal…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {credential && (
        <CredentialBanner credential={credential} onDismiss={() => setCredential(null)} />
      )}

      {analytics && (
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            { label: 'Total users', value: analytics.totalUsers },
            { label: 'Pending', value: analytics.pendingApprovals, accent: analytics.pendingApprovals > 0 },
            { label: 'Admins', value: analytics.admins },
            { label: 'Suspended', value: analytics.suspendedUsers },
            { label: 'Active calls', value: analytics.activeCalls },
            { label: 'Active units', value: analytics.activeUnits },
          ].map((stat) => (
            <div
              key={stat.label}
              className={`rounded-2xl border p-3 ${
                stat.accent ? 'border-amber-500/40 bg-amber-500/10' : 'border-slate-700/60 bg-slate-900/80'
              }`}
            >
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{stat.label}</p>
              <p className="mt-2 text-2xl font-bold text-white">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      <section className="panel-glass rounded-3xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-cyan-300">Pending access requests</p>
            <p className="text-xs text-slate-400">
              People who signed up in-app and are waiting on approval
            </p>
          </div>
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs text-amber-200">
            {pending.length} waiting
          </span>
        </div>

        {pending.length === 0 ? (
          <p className="rounded-2xl border border-slate-700/60 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
            No pending requests.
          </p>
        ) : (
          <div className="space-y-2">
            {pending.map((entry) => (
              <PendingRow
                key={entry.id}
                entry={entry}
                roles={roles}
                departments={departments}
                busy={busyId === entry.id}
                onApprove={(role, department) => runAction(entry.id, () =>
                  apiRequest(`/api/admin/users/${entry.id}/approve`, {
                    method: 'POST',
                    body: { role, department },
                  }))}
                onDeny={() => runAction(entry.id, () =>
                  apiRequest(`/api/admin/users/${entry.id}/deny`, { method: 'POST' }))}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel-glass rounded-3xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-cyan-300" />
            <div>
              <p className="text-sm font-medium text-cyan-300">User roster</p>
              <p className="text-xs text-slate-400">Roles, status, and credential control</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              className="rounded-xl border border-slate-700/60 px-3 py-2 text-xs text-slate-300 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="flex items-center gap-2 rounded-xl bg-cyan-500/25 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/35"
            >
              <UserPlus className="h-4 w-4" /> Create account
            </button>
          </div>
        </div>

        {showCreate && (
          <CreateUserForm
            roles={roles}
            departments={departments}
            onCancel={() => setShowCreate(false)}
            onCreated={(cred) => {
              setCredential(cred);
              setShowCreate(false);
              load();
            }}
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.2em] text-slate-500">
                <th className="px-3 py-1">User</th>
                <th className="px-3 py-1">Role</th>
                <th className="px-3 py-1">Department</th>
                <th className="px-3 py-1">Status</th>
                <th className="px-3 py-1">Last sign-in</th>
                <th className="px-3 py-1 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((entry) => {
                const isSelf = entry.id === currentUser?.id;
                const busy = busyId === entry.id;

                return (
                  <tr key={entry.id} className="bg-slate-900/70">
                    <td className="rounded-l-2xl px-3 py-3">
                      <p className="font-semibold text-white">{entry.fullName}</p>
                      <p className="text-xs text-slate-400">
                        {entry.username}{isSelf && ' · you'}
                      </p>
                      {entry.mustChangePassword && (
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-300">
                          Password change pending
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <select
                        className="rounded-lg border border-slate-700/70 bg-slate-950/70 px-2 py-1 text-xs text-slate-200 disabled:opacity-50"
                        value={entry.role}
                        disabled={busy || isSelf}
                        onChange={(e) => runAction(entry.id, () =>
                          apiRequest(`/api/admin/users/${entry.id}`, {
                            method: 'PATCH',
                            body: { role: e.target.value },
                          }))}
                      >
                        {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        className="rounded-lg border border-slate-700/70 bg-slate-950/70 px-2 py-1 text-xs text-slate-200 disabled:opacity-50"
                        value={entry.department}
                        disabled={busy}
                        onChange={(e) => runAction(entry.id, () =>
                          apiRequest(`/api/admin/users/${entry.id}`, {
                            method: 'PATCH',
                            body: { department: e.target.value },
                          }))}
                      >
                        {departments.map((dept) => <option key={dept} value={dept}>{dept}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${statusStyles[entry.status] || ''}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400">{formatDate(entry.lastLoginAt)}</td>
                    <td className="rounded-r-2xl px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}

                        <IconButton
                          title="Generate a new password"
                          onClick={() => handleResetPassword(entry)}
                          disabled={busy}
                        >
                          <KeyRound className="h-4 w-4" />
                        </IconButton>

                        {entry.status === 'active' ? (
                          <IconButton
                            title={isSelf ? 'You cannot suspend yourself' : 'Suspend account'}
                            onClick={() => runAction(entry.id, () =>
                              apiRequest(`/api/admin/users/${entry.id}/suspend`, { method: 'POST' }))}
                            disabled={busy || isSelf}
                          >
                            <Pause className="h-4 w-4" />
                          </IconButton>
                        ) : (
                          <IconButton
                            title="Reactivate account"
                            onClick={() => runAction(entry.id, () =>
                              apiRequest(`/api/admin/users/${entry.id}/reactivate`, { method: 'POST' }))}
                            disabled={busy}
                          >
                            <Play className="h-4 w-4" />
                          </IconButton>
                        )}

                        <IconButton
                          title={isSelf ? 'You cannot delete yourself' : 'Delete account'}
                          onClick={() => handleDelete(entry)}
                          disabled={busy || isSelf}
                          danger
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-glass rounded-3xl p-4">
        <p className="text-sm font-medium text-cyan-300">Audit log</p>
        <p className="mb-3 text-xs text-slate-400">Every account action, newest first</p>

        <div className="space-y-2">
          {audit.length === 0 && (
            <p className="text-sm text-slate-400">Nothing recorded yet.</p>
          )}
          {audit.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-slate-700/60 bg-slate-900/70 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-white">{entry.action}</p>
                <p className="shrink-0 text-xs text-slate-500">{formatDate(entry.createdAt)}</p>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {entry.actorName}
                {entry.targetName ? ` → ${entry.targetName}` : ''} · {entry.detail}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function IconButton({
  children, onClick, disabled, title, danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border border-slate-700/60 p-2 transition disabled:cursor-not-allowed disabled:opacity-30 ${
        danger ? 'text-red-300 hover:bg-red-500/15' : 'text-slate-300 hover:bg-cyan-500/15 hover:text-cyan-200'
      }`}
    >
      {children}
    </button>
  );
}

function CredentialBanner({ credential, onDismiss }: { credential: Credential; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(credential.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-3xl border border-emerald-500/40 bg-emerald-500/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-100">
            {credential.context === 'created' ? 'Account created' : 'Password reset'} — {credential.fullName}
          </p>
          <p className="mt-1 text-xs text-emerald-200/80">
            {credential.emailed
              ? `Emailed to ${credential.username}. Shown once here too, in case you need to relay it.`
              : `Shown once and not recoverable — no email on file, so you will need to pass this on.`}
            {' '}They must change it at next sign-in.
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="rounded-lg p-1 text-emerald-200 hover:bg-emerald-500/20">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-xl bg-slate-950/80 px-4 py-2 font-mono text-lg tracking-wider text-white">
          {credential.password}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-2 rounded-xl bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30"
        >
          {copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function PendingRow({
  entry, roles, departments, busy, onApprove, onDeny,
}: {
  entry: SessionUser;
  roles: string[];
  departments: string[];
  busy: boolean;
  onApprove: (role: string, department: string) => void;
  onDeny: () => void;
}) {
  const [role, setRole] = useState(entry.role);
  const [department, setDepartment] = useState(entry.department);

  return (
    <div className="rounded-2xl border border-amber-500/25 bg-slate-900/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[200px]">
          <p className="font-semibold text-white">{entry.fullName}</p>
          <p className="text-xs text-slate-400">
            {entry.username}{entry.email ? ` · ${entry.email}` : ''} · requested {formatDate(entry.createdAt)}
          </p>
          {entry.note && <p className="mt-1 text-xs italic text-slate-300">“{entry.note}”</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-slate-700/70 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-200"
            value={role}
            onChange={(e) => setRole(e.target.value as SessionUser['role'])}
            disabled={busy}
          >
            {roles.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>

          <select
            className="rounded-lg border border-slate-700/70 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-200"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            disabled={busy}
          >
            {departments.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>

          <button
            type="button"
            onClick={() => onApprove(role, department)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve
          </button>

          <button
            type="button"
            onClick={onDeny}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/25 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Deny
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateUserForm({
  roles, departments, onCancel, onCreated,
}: {
  roles: string[];
  departments: string[];
  onCancel: () => void;
  onCreated: (credential: Credential) => void;
}) {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roles[roles.length - 1] || 'officer');
  const [department, setDepartment] = useState(departments[0] || 'Police');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await apiRequest<{ tempPassword: string; emailed: boolean }>('/api/admin/users', {
        method: 'POST',
        body: { username, fullName, email, role, department },
      });
      onCreated({
        username,
        fullName,
        password: data.tempPassword,
        context: 'created',
        emailed: data.emailed,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create that account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-4 rounded-2xl border border-cyan-500/25 bg-slate-950/50 p-4">
      <p className="mb-3 text-sm font-medium text-cyan-200">
        New account — a strong password is generated automatically
      </p>

      {error && (
        <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="new-fullname">Full name</label>
          <input id="new-fullname" className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <label className={labelClass} htmlFor="new-username">Username</label>
          <input id="new-username" className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div>
          <label className={labelClass} htmlFor="new-email">Email <span className="text-slate-600">(optional)</span></label>
          <input id="new-email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Emails them the password; needed for self-service reset.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="new-role">Role</label>
          <select id="new-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="new-department">Department</label>
          <select id="new-department" className={inputClass} value={department} onChange={(e) => setDepartment(e.target.value)}>
            {departments.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded-xl bg-cyan-500/25 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/35 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Create &amp; generate password
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
