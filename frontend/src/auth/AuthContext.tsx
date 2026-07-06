import { createContext, useContext, useState, type ReactNode } from 'react';
import client from '../api/client';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: string;
  impersonator?: {
    id: number;
    username: string;
    name: string;
    role: string;
  } | null;
}

interface Ctx {
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<void>;
  impersonate: (userId: number) => Promise<void>;
  stopImpersonating: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const s = localStorage.getItem('user');
    return s ? JSON.parse(s) : null;
  });

  const setSession = (token: string, nextUser: AuthUser) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(nextUser));
    setUser(nextUser);
  };

  const login = async (username: string, password: string) => {
    const { data } = await client.post('/auth/login', { username, password });
    setSession(data.token, data.user);
  };

  const impersonate = async (userId: number) => {
    const { data } = await client.post('/auth/impersonate', { userId });
    setSession(data.token, data.user);
  };

  const stopImpersonating = async () => {
    const { data } = await client.post('/auth/stop-impersonating');
    setSession(data.token, data.user);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, login, impersonate, stopImpersonating, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
