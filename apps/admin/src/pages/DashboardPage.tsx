import { Card } from '@hellogram/ui';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../api.js';

const LABELS: Record<string, string> = {
  accounts: 'Accounts',
  activeNumbers: 'Active numbers',
  messages24h: 'Messages (24 h)',
  calls24h: 'Calls (24 h)',
  openReports: 'Open reports',
  openGrievances: 'Open grievances',
  activeSubscriptions: 'Paying subscriptions',
  ack: 'Grievances past 24 h ack',
  resolve: 'Grievances past 15-day resolve',
};

export function DashboardPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => adminApi<Record<string, number>>('/stats') });
  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Object.entries(stats.data ?? {}).map(([key, value]) => (
          <Card key={key} className={`p-4 ${(key === 'ack' || key === 'resolve') && value > 0 ? 'border-danger' : ''}`}>
            <p className="text-sm text-muted">{LABELS[key] ?? key}</p>
            <p className="mt-1 text-3xl font-bold">{value.toLocaleString()}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
