import { useCallback, useEffect, useState } from 'react';
import { type EngineConfig, normalizeConfig } from '../engine/params';
import { deleteItem, listItems, putItem } from '../storage/db';

export interface SavedConfig {
  id: string;
  name: string;
  savedAt: string;
  config: EngineConfig;
}

export function useSavedConfigs() {
  const [items, setItems] = useState<SavedConfig[]>([]);
  const reload = useCallback(async () => {
    try {
      const l = await listItems<SavedConfig>('configs');
      setItems(l.map((c) => ({ ...c, config: normalizeConfig(c.config) })).sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const save = async (config: EngineConfig) => {
    const id = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'config';
    await putItem('configs', { id, name: config.name, savedAt: new Date().toISOString(), config });
    await reload();
  };
  const remove = async (id: string) => {
    await deleteItem('configs', id);
    await reload();
  };
  return { items, reload, save, remove };
}
