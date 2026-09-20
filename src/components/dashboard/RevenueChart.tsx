import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatInr, fromPaise } from '../../domain/money';
import { type MonthlyRevenue } from '../../types/payment';
import { AccessibleChart } from './AccessibleChart';

/**
 * Revenue per IST month (cash basis: payments by payment date, voided excluded). The exact integer-paise totals come from the
 * aggregation queries; rupees are derived here for DISPLAY only (the chart scale and tooltip), never summed or stored.
 * Loaded lazily by the dashboard so the charting library stays out of the main bundle. The same numbers are available as text
 * through AccessibleChart.
 */
export default function RevenueChart({ months }: { months: MonthlyRevenue[] }) {
  const data = months.map((m) => ({ month: m.label, revenue: fromPaise(m.totalPaise), paise: m.totalPaise }));
  return (
    <AccessibleChart label="Revenue by month" valueLabel="Revenue (₹)" rows={data.map((d) => ({ label: d.month, value: d.revenue }))}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={64} tickFormatter={(v: number) => `₹${new Intl.NumberFormat('en-IN').format(v)}`} />
          <Tooltip formatter={(_value, _name, item) => [formatInr((item.payload as { paise: number }).paise), 'Revenue']} />
          <Bar dataKey="revenue" name="Revenue" fill="#1b3a57" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </AccessibleChart>
  );
}
