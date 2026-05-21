import { createContext, useContext, useEffect, useRef, useState } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { queryClient } from "./queryClient";

const TOKEN_KEY = "ops_access_token";

function getStoredToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function storeToken(t: string): void {
  try { localStorage.setItem(TOKEN_KEY, t); } catch {}
}
function clearToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

export interface AuthUser {
  id: number;
  fullName: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  employeeNumber: string | null;
  position: string | null;
  avatarUrl: string | null;
  phoneNumber: string | null;
  languagePreference: string | null;
  workspaceId: number | null;
  departmentId: number | null;
  role: string;
  status: string;
  mustResetPassword: boolean;
  platformRoleCode?: string | null;
  isRootOwner?: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  signIn: (employeeNumber: string, password: string) => Promise<AuthUser>;
  signOut: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoaded: false,
  isSignedIn: false,
  signIn: async () => { throw new Error("AuthProvider not mounted"); },
  signOut: () => {},
  refreshUser: async () => {},
});

async function fetchMe(token: string): Promise<AuthUser | null> {
  try {
    const r = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return r.json() as Promise<AuthUser>;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const tokenRef = useRef<string | null>(null);

  function applyToken(token: string | null) {
    tokenRef.current = token;
    if (token) {
      setAuthTokenGetter(() => token);
    } else {
      setAuthTokenGetter(null);
    }
  }

  useEffect(() => {
    const stored = getStoredToken();
    if (!stored) {
      setIsLoaded(true);
      return;
    }
    applyToken(stored);
    fetchMe(stored).then((u) => {
      if (u) {
        setUser(u);
      } else {
        clearToken();
        applyToken(null);
      }
    }).finally(() => setIsLoaded(true));
  }, []);

  async function signIn(employeeNumber: string, password: string): Promise<AuthUser> {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeNumber, password }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error((err as any).error ?? "Invalid credentials");
    }
    const { accessToken, user: userData } = (await r.json()) as { accessToken: string; user: AuthUser };
    storeToken(accessToken);
    applyToken(accessToken);
    setUser(userData);
    return userData;
  }

  function signOut() {
    clearToken();
    applyToken(null);
    setUser(null);
    queryClient.clear();
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  }

  async function refreshUser() {
    const token = tokenRef.current ?? getStoredToken();
    if (!token) return;
    const u = await fetchMe(token);
    if (u) setUser(u);
  }

  return (
    <AuthContext.Provider value={{ user, isLoaded, isSignedIn: !!user, signIn, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAppAuth() {
  return useContext(AuthContext);
}
