import { useQuery } from '@tanstack/react-query';
import { adminApi, fmt } from '../api.js';

interface Entry {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

export function AuditPage() {
  const log = useQuery({ queryKey: ['audit'], queryFn: () => adminApi<Entry[]>('/audit') });
  return (
    <div>
      <h1 className="text-2xl font-bold">Audit log</h1>
      <table className="mt-4 w-full text-left text-sm">
        <thead className="text-muted">
          <tr>
            <th className="py-2">When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {log.data?.map((e) => (
            <tr key={e.id}>
              <td className="py-2 whitespace-nowrap">{fmt(e.createdAt)}</td>
              <td className="font-mono text-xs">{e.actorType}:{e.actorId?.slice(0, 8) ?? '—'}</td>
              <td>{e.action}</td>
              <td className="font-mono text-xs">{e.targetType ? `${e.targetType}:${e.targetId?.slice(0, 8)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
