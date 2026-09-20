import { Paper, Tab, Tabs } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/common/PageHeader';
import { ReportPanel } from '../../components/reports/ReportPanel';
import { REPORT_LABELS } from '../../domain/reports';
import { isReportId, REPORT_IDS, type ReportId } from '../../types/report';

/**
 * Reports (Admin only, US-6.1, US-6.3): six reports, each with its own date filters, a server-side paginated table, totals from
 * aggregations and a CSV export. The page is gated by the route (`allow: ['ADMIN']`); members and attendance reads are
 * Staff-readable in the rules, so the route guard plus the Admin-only export audit are what keep Staff out of bulk exports.
 * The selected report lives in `?report=` so a report can be bookmarked; switching report starts from that report's defaults.
 */
export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('report')?.toUpperCase();
  const report: ReportId = isReportId(requested) ? requested : 'MEMBERS';

  return (
    <>
      <PageHeader title="Reports" subtitle="Six reports with date filters and CSV export. Dates are inclusive whole days in IST." />
      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs
          value={report}
          onChange={(_e, value: ReportId) => setParams({ report: value.toLowerCase() }, { replace: true })}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Reports"
        >
          {REPORT_IDS.map((id) => (
            <Tab key={id} value={id} label={REPORT_LABELS[id]} id={`report-tab-${id}`} />
          ))}
        </Tabs>
      </Paper>
      <ReportPanel key={report} report={report} />
    </>
  );
}
