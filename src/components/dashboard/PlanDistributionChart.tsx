import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { type PlanDistributionEntry } from '../../types/member';
import { AccessibleChart } from './AccessibleChart';

/** Members with an Active or Expiring-soon membership, per plan (NEW-19). Lazy-loaded with the other chart. */
export default function PlanDistributionChart({ entries }: { entries: PlanDistributionEntry[] }) {
  const data = entries.map((e) => ({ plan: e.planName, count: e.count }));
  return (
    <AccessibleChart label="Members per plan" valueLabel="Members" rows={data.map((d) => ({ label: d.plan, value: d.count }))}>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44 + 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
          <YAxis type="category" dataKey="plan" width={110} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value) => [String(value), 'Members']} />
          <Bar dataKey="count" name="Members" fill="#2e7d32" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </AccessibleChart>
  );
}
