/**
 * P20-E — Encrypted credential storage (refs only in API responses)
 */
import { encryptSecret, decryptSecret } from "../secret-encryption";

export type CredentialBundle = {
  apiKey?: string;
  webhookSecret?: string;
  bearerToken?: string;
  [key: string]: string | undefined;
};

export function encryptCredentials(bundle: CredentialBundle): string {
  return encryptSecret(JSON.stringify(bundle));
}

export function decryptCredentials(encrypted: string | null): CredentialBundle {
  if (!encrypted) return {};
  try {
    const parsed = JSON.parse(decryptSecret(encrypted)) as CredentialBundle;
    return parsed ?? {};
  } catch {
    return {};
  }
}

/** Strip secrets from API responses */
export function redactIntegrationForApi<T extends { credentialEncrypted?: string | null }>(
  row: T,
): Omit<T, "credentialEncrypted"> & { hasCredentials: boolean; credentialVersion?: number } {
  const { credentialEncrypted, ...rest } = row;
  return {
    ...rest,
    hasCredentials: Boolean(credentialEncrypted),
  };
}
