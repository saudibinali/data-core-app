const SENSITIVE_KEYS = /^(password|secret|token|apikey|api_key|authorization|credential|webhooksecret)$/i;

export function maskPayloadForDisplay(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;
  if (Array.isArray(payload)) return payload.map(maskPayloadForDisplay);
  if (typeof payload !== "object") return payload;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(k)) {
      out[k] = "***";
    } else if (typeof v === "object" && v !== null) {
      out[k] = maskPayloadForDisplay(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function parseAndMaskPayloadJson(json: string): unknown {
  try {
    return maskPayloadForDisplay(JSON.parse(json));
  } catch {
    return { _parseError: true, preview: json.slice(0, 200) };
  }
}
