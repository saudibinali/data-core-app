import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";

/** Sidebar drawer / overlay navigation (closes after route change on mobile). */
export function useMobileNav() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  const openNav = useCallback(() => setOpen(true), []);
  const closeNav = useCallback(() => setOpen(false), []);
  const toggleNav = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    setOpen(false);
  }, [location]);

  return { open, setOpen, openNav, closeNav, toggleNav };
}
