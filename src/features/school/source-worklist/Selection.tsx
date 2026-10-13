'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface WorklistSelection {
  keys: ReadonlySet<string>; busy: boolean; setBusy(value: boolean): void;
  toggle(keys: readonly string[], checked: boolean): void; clear(): void;
}
const Context = createContext<WorklistSelection | null>(null);
export function WorklistSelectionProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set()), [busy, setBusy] = useState(false);
  const value = useMemo(() => ({ keys, busy, setBusy,
    toggle(ids: readonly string[], checked: boolean) { setKeys(current => { const next = new Set(current); for (const id of ids) { if (checked) next.add(id); else next.delete(id); } return next; }); },
    clear() { setKeys(new Set()); },
  }), [keys, busy]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useWorklistSelection = () => useContext(Context);
