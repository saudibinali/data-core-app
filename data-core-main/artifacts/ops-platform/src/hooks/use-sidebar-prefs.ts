import { useState, useCallback, useEffect, useRef } from "react";
import { useGetMe } from "@workspace/api-client-react";

interface SidebarPrefs {
  order: string[];
  pinned: string[];
}

function storageKey(userId: number) {
  return `sidebar_prefs_v1_${userId}`;
}

function loadPrefs(userId: number, defaults: string[]): SidebarPrefs {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { order: defaults, pinned: [] };
    const saved: SidebarPrefs = JSON.parse(raw);
    const savedOrder = (saved.order ?? []).filter((id) => defaults.includes(id));
    const newItems = defaults.filter((id) => !savedOrder.includes(id));
    return {
      order: [...savedOrder, ...newItems],
      pinned: (saved.pinned ?? []).filter((id) => defaults.includes(id)),
    };
  } catch {
    return { order: defaults, pinned: [] };
  }
}

function savePrefs(userId: number, prefs: SidebarPrefs) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {}
}

export function useSidebarPrefs(defaultOrder: string[]) {
  const { data: me } = useGetMe();
  const userId = me?.id;
  const defaultsRef = useRef(defaultOrder);
  defaultsRef.current = defaultOrder;

  const [prefs, setPrefs] = useState<SidebarPrefs>({ order: defaultOrder, pinned: [] });

  const prevUserIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!userId || userId === prevUserIdRef.current) return;
    prevUserIdRef.current = userId;
    setPrefs(loadPrefs(userId, defaultsRef.current));
  }, [userId]);

  const prevDefaultsKeyRef = useRef<string>("");
  useEffect(() => {
    const key = defaultOrder.join(",");
    if (prevDefaultsKeyRef.current === key) return;
    prevDefaultsKeyRef.current = key;
    if (!userId) return;
    setPrefs((prev) => {
      const currentAll = new Set([...prev.order, ...prev.pinned]);
      const newItems = defaultOrder.filter((id) => !currentAll.has(id));
      const validOrder = prev.order.filter((id) => defaultOrder.includes(id));
      const validPinned = prev.pinned.filter((id) => defaultOrder.includes(id));
      if (newItems.length === 0 && validOrder.length === prev.order.length && validPinned.length === prev.pinned.length) return prev;
      const next = { order: [...validOrder, ...newItems], pinned: validPinned };
      savePrefs(userId, next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOrder.join(","), userId]);

  const reorderMain = useCallback((newOrder: string[]) => {
    setPrefs((prev) => { const next = { ...prev, order: newOrder }; if (userId) savePrefs(userId, next); return next; });
  }, [userId]);

  const reorderPinned = useCallback((newPinned: string[]) => {
    setPrefs((prev) => { const next = { ...prev, pinned: newPinned }; if (userId) savePrefs(userId, next); return next; });
  }, [userId]);

  const pin = useCallback((id: string) => {
    setPrefs((prev) => {
      const next: SidebarPrefs = { order: prev.order.filter((x) => x !== id), pinned: [...prev.pinned, id] };
      if (userId) savePrefs(userId, next);
      return next;
    });
  }, [userId]);

  const unpin = useCallback((id: string) => {
    setPrefs((prev) => {
      const next: SidebarPrefs = { order: [id, ...prev.order], pinned: prev.pinned.filter((x) => x !== id) };
      if (userId) savePrefs(userId, next);
      return next;
    });
  }, [userId]);

  return { pinnedIds: prefs.pinned, mainOrder: prefs.order, reorderMain, reorderPinned, pin, unpin };
}
