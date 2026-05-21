import { useState, useCallback, useEffect, useRef } from "react";
import { useGetMe } from "@workspace/api-client-react";

interface HomePrefs {
  order: string[];
  collapsed: string[];
  hidden: string[];
}

function storageKey(userId: number) {
  return `home_prefs_v1_${userId}`;
}

function loadPrefs(userId: number, defaults: string[]): HomePrefs {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { order: defaults, collapsed: [], hidden: [] };
    const saved: HomePrefs = JSON.parse(raw);
    const savedOrder = (saved.order ?? []).filter((id) => defaults.includes(id));
    const newItems = defaults.filter((id) => !savedOrder.includes(id));
    return {
      order: [...savedOrder, ...newItems],
      collapsed: (saved.collapsed ?? []).filter((id) => defaults.includes(id)),
      hidden: (saved.hidden ?? []).filter((id) => defaults.includes(id)),
    };
  } catch {
    return { order: defaults, collapsed: [], hidden: [] };
  }
}

function savePrefs(userId: number, prefs: HomePrefs) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {}
}

export function useHomePrefs(defaultOrder: string[]) {
  const { data: me } = useGetMe();
  const userId = me?.id;
  const defaultsRef = useRef(defaultOrder);

  const [prefs, setPrefs] = useState<HomePrefs>({
    order: defaultOrder,
    collapsed: [],
    hidden: [],
  });

  const prevUserIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!userId || userId === prevUserIdRef.current) return;
    prevUserIdRef.current = userId;
    setPrefs(loadPrefs(userId, defaultsRef.current));
  }, [userId]);

  const update = useCallback(
    (updater: (prev: HomePrefs) => HomePrefs) => {
      setPrefs((prev) => {
        const next = updater(prev);
        if (userId) savePrefs(userId, next);
        return next;
      });
    },
    [userId],
  );

  const reorder = useCallback(
    (newOrder: string[]) => update((prev) => ({ ...prev, order: newOrder })),
    [update],
  );

  const toggleCollapsed = useCallback(
    (id: string) =>
      update((prev) => ({
        ...prev,
        collapsed: prev.collapsed.includes(id)
          ? prev.collapsed.filter((x) => x !== id)
          : [...prev.collapsed, id],
      })),
    [update],
  );

  const toggleHidden = useCallback(
    (id: string) =>
      update((prev) => ({
        ...prev,
        hidden: prev.hidden.includes(id)
          ? prev.hidden.filter((x) => x !== id)
          : [...prev.hidden, id],
      })),
    [update],
  );

  return { order: prefs.order, collapsed: prefs.collapsed, hidden: prefs.hidden, reorder, toggleCollapsed, toggleHidden };
}
