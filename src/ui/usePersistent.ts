import { useEffect, useState } from 'react';

/** État React persisté dans localStorage (préférences de l'utilisateur). */
export function usePersistent<T>(key: string, initial: () => T, normalize?: (raw: unknown) => T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        return normalize ? normalize(parsed) : (parsed as T);
      }
    } catch {
      /* stockage indisponible */
    }
    return initial();
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignoré */
    }
  }, [key, value]);
  return [value, setValue];
}
