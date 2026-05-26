import { useCallback } from "react";

const TOKEN_KEY = "ops_access_token";

function getStoredToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

/**
 * Returns an auth-aware fetch function that automatically adds
 * the Bearer token to every request.
 *
 * @deprecated F3.3 — Prefer generated hooks/functions from `@workspace/api-client-react`
 * when the route exists in OpenAPI. This hook remains as a fallback during migration.
 */
export function useApiFetch() {
  const apiFetch = useCallback(
    async (input: string, init?: RequestInit): Promise<Response> => {
      const token = getStoredToken();
      const headers = new Headers(init?.headers);
      if (token && !headers.has("authorization")) {
        headers.set("authorization", `Bearer ${token}`);
      }
      if (
        !headers.has("content-type") &&
        init?.body &&
        !(init.body instanceof FormData)
      ) {
        headers.set("content-type", "application/json");
      }
      return fetch(input, { ...init, headers });
    },
    [],
  );

  return apiFetch;
}
