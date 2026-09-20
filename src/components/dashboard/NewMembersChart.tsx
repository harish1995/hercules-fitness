import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { type DashboardStats } from '../../types/member';
import { AccessibleChart } from './AccessibleChart';

/**
 * New members per IST month (by joining date). Loaded lazily by the dashboard so the charting library stays out of
 * the main bundle. recharts is the library the architecture names for the dashboard charts. The same numbers are
 * available as text through AccessibleChart.
 */
export default function NewMembersChart({ months }: { months: DashboardStats['newMembersByMonth'] }) {
  const data = months.map((m) => ({ month: m.label, count: m.count }));
  return (
    <AccessibleChart label="New members by month" valueLabel="New members" rows={data.map((d) => ({ label: d.month, value: d.count }))}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value) => [String(value), 'New members']} />
          <Bar dataKey="count" name="New members" fill="#1b3a57" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </AccessibleChart>
  );
}
