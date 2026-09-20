import { Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ATTENDANCE_STATUS_LABELS } from '../../constants/enums';
import { memberProfilePath } from '../../constants/routes';
import { checkOutLabel } from '../../domain/attendance';
import { formatIstDate, formatIstTime } from '../../domain/dates';
import { type AttendanceRecord } from '../../types/attendance';

interface AttendanceTableProps {
  records: AttendanceRecord[];
  label: string;
  /** today's list shows who; a member's own history does not repeat the name */
  showMember: boolean;
  /** the instant the "Still in" / "Not recorded" wording is judged against (today's IST day) */
  now: Date;
  dim?: boolean;
  actions?: (record: AttendanceRecord) => ReactNode;
}

/** Attendance rows: date, status, check-in, check-out ("Still in" today, "Not recorded" when a past day has none, NEW-13). */
export function AttendanceTable({ records, label, showMember, now, dim = false, actions }: AttendanceTableProps) {
  return (
    <TableContainer>
      <Table size="small" aria-label={label} sx={{ opacity: dim ? 0.6 : 1 }}>
        <TableHead>
          <TableRow>
            {showMember && <TableCell>Member</TableCell>}
            <TableCell>Date</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Check-in</TableCell>
            <TableCell>Check-out</TableCell>
            {actions && <TableCell align="right">Actions</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {records.map((r) => {
            const out = checkOutLabel(r, now);
            return (
              <TableRow key={r.id} hover>
                {showMember && (
                  <TableCell>
                    <RouterLink to={memberProfilePath(r.memberDocId)}>{r.memberName}</RouterLink>
                    <div>
                      <small>{r.memberId}</small>
                    </div>
                  </TableCell>
                )}
                <TableCell>{formatIstDate(r.date)}</TableCell>
                <TableCell>
                  <Chip size="small" color={r.status === 'PRESENT' ? 'success' : 'default'} variant={r.status === 'PRESENT' ? 'filled' : 'outlined'} label={ATTENDANCE_STATUS_LABELS[r.status]} />
                </TableCell>
                <TableCell>{r.checkInAt ? formatIstTime(r.checkInAt) : '—'}</TableCell>
                <TableCell>{out === 'Still in' ? <Chip size="small" color="info" label="Checked in" /> : out}</TableCell>
                {actions && <TableCell align="right">{actions(r)}</TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
