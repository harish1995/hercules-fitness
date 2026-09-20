import { Alert, Box, Chip, Paper, Stack, Typography } from '@mui/material';
import { type ReactNode } from 'react';
import { PageHeader } from '../components/common/PageHeader';
import { GYM_NAME } from '../constants/app';
import { NOTIFICATION_CHANNEL_LABELS, NOTIFICATION_CHANNELS } from '../constants/enums';
import { IST_ZONE } from '../domain/dates';
import { EXPORT_MAX_ROWS } from '../domain/reports';
import { EXPIRING_SOON_MAX_DAYS } from '../domain/status';
import { getNotificationService } from '../services/notificationService';

/**
 * Settings (Admin only). Read-only by design in this release: FR-15 / NEW-2 default the Settings page to a placeholder and list
 * no editable setting, so no `settings/*` document, write path or rule exists. This page only states the fixed business rules
 * the app runs on (so nobody goes looking for a switch that does not exist) and the notification status (FR-11, NEW-21).
 *
 * The expiring-soon window is deliberately NOT editable (D-4): the status badge, list filters, Expiring / Expired pages,
 * dashboard cards and reports all derive from the same 7-day rule, and stored data (e.g. query ranges, indexes, tests) assume it.
 */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, py: 1.25, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: { xs: '100%', sm: 240 }, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
      <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

export function SettingsPage() {
  const notifications = getNotificationService();

  return (
    <>
      <PageHeader title="Settings" subtitle="How the app is set up. Nothing on this page can be changed from the app." />

      <Section title="Gym">
        <Row label="Gym name">{GYM_NAME}</Row>
        <Row label="Time zone">{IST_ZONE} (dates are whole Indian calendar days)</Row>
        <Row label="Date format">DD/MM/YYYY</Row>
        <Row label="Currency">Indian rupee (INR), stored in paise</Row>
      </Section>

      <Section title="Membership rules (fixed)">
        <Row label="Expiring soon window">
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {EXPIRING_SOON_MAX_DAYS} days
          </Typography>
          <Typography variant="body2" color="text.secondary">
            A membership is Expiring soon from {EXPIRING_SOON_MAX_DAYS} days before its end date up to and including the end date, and
            Active before that. The same rule drives the status badges, the members list filters, the Expiring soon and Expired pages,
            the dashboard cards and the reports, so it is fixed and cannot be edited here. Changing it is a code change that has to
            be re-tested everywhere.
          </Typography>
        </Row>
        <Row label="CSV export limit">{EXPORT_MAX_ROWS.toLocaleString('en-IN')} rows per export</Row>
      </Section>

      <Section title="Notifications">
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Reminders are not sent. No WhatsApp, SMS, email or push provider is connected, and the app does not create notification
          records. Membership status is worked out live from the dates, so the Expiring soon page always shows who needs a reminder.
        </Alert>
        <Row label="Provider">
          <Chip size="small" variant="outlined" label={`${notifications.providerName} (nothing is delivered)`} />
        </Row>
        <Row label="Channels">
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {NOTIFICATION_CHANNELS.map((channel) => (
              <Chip key={channel} size="small" label={`${NOTIFICATION_CHANNEL_LABELS[channel]}: not configured`} />
            ))}
          </Stack>
        </Row>
      </Section>
    </>
  );
}
