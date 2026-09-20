import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { type MonthlyAttendanceByMonth } from '../../types/attendance';
import { AccessibleChart } from './AccessibleChart';

/**
 * PRESENT records per IST month (last 12). The counts come from `count()` aggregations over IST month boundaries. Loaded lazily
 * by the dashboard so the charting library stays out of the main bundle; the same numbers are available as text through
 * AccessibleChart.
 */
export default function AttendanceChart({ months }: { months: MonthlyAttendanceByMonth[] }) {
  const data = months.map((m) => ({ month: m.label, count: m.count }));
  return (
    <AccessibleChart label="Attendance by month" valueLabel="Check-ins" rows={data.map((d) => ({ label: d.month, value: d.count }))}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value) => [String(value), 'Check-ins']} />
          <Bar dataKey="count" name="Check-ins" fill="#1b3a57" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </AccessibleChart>
  );
}
