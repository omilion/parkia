import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetchJson } from '../../lib/api';
import type { SystemConfig, Totem } from '../../types';

type SettingsData = { config: SystemConfig; totems: Totem[]; health: any; importTemplates: any[]; tenantContext: any; backups: any[] };
export function useSettingsData() {
  const client = useQueryClient();
  const query = useQuery<SettingsData>({ queryKey: ['settings'], queryFn: async ({ signal }) => {
    const [config, totems, health, templates, context] = await Promise.all([
      apiFetchJson<SystemConfig>('/api/config', { signal }), apiFetchJson<Totem[]>('/api/totems', { signal }),
      apiFetchJson<any>('/api/health/details', { signal }).catch(() => null),
      apiFetchJson<any>('/api/import/templates', { signal }).catch(() => ({ templates: [] })),
      apiFetchJson<any>('/api/tenant/context', { signal }),
    ]);
    const backupData = context?.is_platform_admin ? await apiFetchJson<any>('/api/backups/database', { signal }) : null;
    return { config, totems, health, importTemplates: templates.templates || [], tenantContext: context, backups: backupData?.backups || [] };
  } });
  return { ...query,
    fetchData: () => client.invalidateQueries({ queryKey: ['settings'] }),
    setBackups: (update: (previous: any[]) => any[]) => client.setQueryData<SettingsData>(['settings'], previous => previous ? { ...previous, backups: update(previous.backups) } : previous),
  };
}
