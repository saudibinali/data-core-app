import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppAuth } from "@/lib/auth";

const TOKEN_KEY = "ops_access_token";
function getStoredToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx || _audioCtx.state === "closed") _audioCtx = new AudioContext();
    return _audioCtx;
  } catch { return null; }
}
function resumeAudioCtx() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}
if (typeof window !== "undefined") {
  window.addEventListener("click",      resumeAudioCtx, { passive: true });
  window.addEventListener("keydown",    resumeAudioCtx, { passive: true });
  window.addEventListener("touchstart", resumeAudioCtx, { passive: true });
  window.addEventListener("pointerdown",resumeAudioCtx, { passive: true });
}

async function playNotificationSound(): Promise<void> {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return;
    const now = ctx.currentTime;
    const note = (freq: number, start: number, dur: number, vol = 0.28) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.start(now + start); osc.stop(now + start + dur + 0.05);
    };
    note(659, 0, 0.45); note(523, 0.22, 0.55);
  } catch {}
}

export function useRealtime(): void {
  const { isSignedIn } = useAppAuth();
  const queryClient = useQueryClient();
  const abortRef   = useRef<AbortController | null>(null);
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(3_000);

  useEffect(() => {
    if (!isSignedIn) return;
    let active = true;

    async function connect() {
      if (!active) return;
      try {
        const token = getStoredToken();
        if (!token || !active) return;

        const controller = new AbortController();
        abortRef.current = controller;

        const response = await fetch("/api/stream", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`);
        retryDelay.current = 3_000;

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = "";

        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const eventLine = frame.split("\n").find((l) => l.startsWith("event:"));
            const event     = eventLine?.replace("event:", "").trim();
            if (event === "notification") {
              queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
              queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
              playNotificationSound();
            } else if (event === "message") {
              queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
              queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
              playNotificationSound();
            }
          }
        }
        if (active) retryRef.current = setTimeout(connect, 1_000);
      } catch (err: any) {
        if (err?.name === "AbortError" || !active) return;
        const delay = retryDelay.current;
        retryDelay.current = Math.min(delay * 1.5, 30_000);
        retryRef.current = setTimeout(connect, delay);
      }
    }

    connect();
    return () => {
      active = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      abortRef.current?.abort();
    };
  }, [isSignedIn, queryClient]);
}
