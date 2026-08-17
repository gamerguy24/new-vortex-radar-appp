import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { apiRequest, clearToken, setToken, getToken, setUnauthorizedHandler } from '../api/client';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: 'admin' | 'supervisor' | 'dispatcher' | 'officer';
  department: string;
  permissions: string[];
  status: 'pending' | 'active' | 'suspended' | 'denied';
  mustChangePassword: boolean;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  lastLoginAt: string | null;
  note: string | null;
}

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  mustChangePassword: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setMustChangePassword(false);
  }, []);

  // Restore an existing session on load, and drop it if the server rejects the token.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setMustChangePassword(false);
    });

    const restore = async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }

      try {
        const data = await apiRequest<{ user: SessionUser; mustChangePassword: boolean }>('/api/auth/me');
        setUser(data.user);
        setMustChangePassword(data.mustChangePassword);
      } catch {
        clearToken();
      } finally {
        setLoading(false);
      }
    };

    restore();
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiRequest<{ token: string; user: SessionUser; mustChangePassword: boolean }>(
      '/api/auth/login',
      { method: 'POST', body: { username, password }, allowUnauthorized: true },
    );
    setToken(data.token);
    setUser(data.user);
    setMustChangePassword(data.mustChangePassword);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const data = await apiRequest<{ token: string; user: SessionUser }>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
      allowUnauthorized: true,
    });
    // The server rotates the token, since the old one carries a stale password version.
    setToken(data.token);
    setUser(data.user);
    setMustChangePassword(false);
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    loading,
    mustChangePassword,
    login,
    logout,
    changePassword,
    isAdmin: user?.role === 'admin',
  }), [user, loading, mustChangePassword, login, logout, changePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
}
