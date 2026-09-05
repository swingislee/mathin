"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface CommunicationWorkSelection {
  selectedKeys: ReadonlySet<string>;
  visibleKeys: readonly string[] | null;
  setVisibleKeys(keys: readonly string[]): void;
  toggle(key: string, selected?: boolean): void;
  toggleMany(keys: readonly string[], selected: boolean): void;
  clear(): void;
}

const emptySelection: CommunicationWorkSelection = {
  selectedKeys: new Set(), visibleKeys: null, setVisibleKeys: () => {}, toggle: () => {}, toggleMany: () => {}, clear: () => {},
};
const Context = createContext<CommunicationWorkSelection>(emptySelection);

export function CommunicationWorkSelectionProvider({ children, initialSelectedKeys = [] }: {
  children: ReactNode; initialSelectedKeys?: readonly string[];
}) {
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set(initialSelectedKeys));
  const [visibleKeys, updateVisibleKeys] = useState<readonly string[] | null>(null);
  const setVisibleKeys = useCallback((keys: readonly string[]) => updateVisibleKeys((current) =>
    current?.length === keys.length && current.every((key, index) => key === keys[index]) ? current : [...keys]), []);
  const toggle = useCallback((key: string, selected?: boolean) => setSelectedKeys((current) => {
    const next = new Set(current);
    if (selected ?? !current.has(key)) next.add(key); else next.delete(key);
    return next;
  }), []);
  const toggleMany = useCallback((keys: readonly string[], selected: boolean) => setSelectedKeys((current) => {
    const next = new Set(current);
    for (const key of keys) { if (selected) next.add(key); else next.delete(key); }
    return next;
  }), []);
  const clear = useCallback(() => setSelectedKeys(new Set()), []);
  const value = useMemo(() => ({ selectedKeys, visibleKeys, setVisibleKeys, toggle, toggleMany, clear }), [selectedKeys, visibleKeys, setVisibleKeys, toggle, toggleMany, clear]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCommunicationWorkSelection() { return useContext(Context); }
