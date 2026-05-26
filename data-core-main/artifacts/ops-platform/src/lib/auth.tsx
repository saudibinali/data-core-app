import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  authLogin,
  authLogout,
  getAuthMe,
  setAuthTokenGetter,
  type AuthSessionUser,
} from "@workspace/api-client-react";
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

export type AuthUser = AuthSessionUser;

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
    setAuthTokenGetter(() => token);
    return await getAuthMe();
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
    try {
      const { accessToken, user: userData } = await authLogin({ employeeNumber, password });
      storeToken(accessToken);
      applyToken(accessToken);
      setUser(userData);
      return userData;
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "data" in err
          ? String((err as { data?: { error?: string } }).data?.error ?? "Invalid credentials")
          : err instanceof Error
            ? err.message
            : "Invalid credentials";
      throw new Error(message);
    }
  }

  function signOut() {
    clearToken();
    applyToken(null);
    setUser(null);
    queryClient.clear();
    void authLogout().catch(() => undefined);
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
