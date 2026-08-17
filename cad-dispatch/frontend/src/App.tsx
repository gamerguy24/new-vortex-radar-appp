import { useState } from 'react';
import { KeyRound, LayoutDashboard, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginView } from './components/LoginView';
import { ChangePasswordView } from './components/ChangePasswordView';
import { AdminPortal } from './components/AdminPortal';
import { DispatchView } from './components/DispatchView';

type Tab = 'dispatch' | 'admin' | 'account';

function Shell() {
  const { user, loading, mustChangePassword, logout, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('dispatch');

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Restoring session…
      </div>
    );
  }

  if (!user) return <LoginView />;

  // A generated password must be replaced before anything else is reachable.
  if (mustChangePassword) return <ChangePasswordView forced />;

  const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'dispatch', label: 'Dispatch', icon: LayoutDashboard },
    ...(isAdmin ? [{ id: 'admin' as Tab, label: 'Admin portal', icon: ShieldCheck }] : []),
    { id: 'account', label: 'Account', icon: KeyRound },
  ];

  return (
    <div className="min-h-screen text-slate-100">
      <div className="mx-auto max-w-[1600px] px-4 py-4">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-500/30 bg-slate-950/70 px-5 py-4 shadow-neon backdrop-blur">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Emergency Communications Center</p>
            <h1 className="mt-1 text-2xl font-bold text-white">Dispatch Command &amp; MDT Suite</h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold text-white">{user.fullName}</p>
              <p className="text-xs text-slate-400">{user.role} · {user.department}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              title="Sign out"
              className="rounded-xl border border-slate-700/60 p-2 text-slate-300 hover:bg-red-500/15 hover:text-red-200"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <nav className="mb-4 flex flex-wrap gap-1 rounded-2xl bg-slate-950/60 p-1">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
                tab === entry.id ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <entry.icon className="h-4 w-4" />
              {entry.label}
            </button>
          ))}
        </nav>

        {tab === 'dispatch' && <DispatchView />}
        {tab === 'admin' && isAdmin && <AdminPortal />}
        {tab === 'account' && <ChangePasswordView />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
