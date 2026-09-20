import { Box, Button, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { PAYMENT_METHOD_LABELS } from '../../constants/enums';
import { memberProfilePath } from '../../constants/routes';
import { formatIstDate } from '../../domain/dates';
import { formatInr } from '../../domain/money';
import { type Payment } from '../../types/payment';

interface PaymentsTableProps {
  payments: Payment[];
  /** Payments page: a Member column (name links to the profile). The profile's own history omits it. */
  showMember: boolean;
  /** Human label of a membership (plan and period); falls back to a short reference. */
  membershipLabel?: (membershipId: string) => string | undefined;
  /** Admin: adds a Void action on non-voided rows. There is deliberately no edit or delete control (immutable). */
  onVoid?: (payment: Payment) => void;
  dim?: boolean;
  label: string;
}

/**
 * Payments as a table (US-4.4). A VOID payment stays in the list, clearly marked (chip, struck-through amount, the reason and
 * who / when), so the history is never rewritten (US-4.7b). Rows have no edit or delete control: payments are immutable.
 */
export function PaymentsTable({ payments, showMember, membershipLabel, onVoid, dim, label }: PaymentsTableProps) {
  return (
    <TableContainer>
      <Table size="small" aria-label={label} sx={{ opacity: dim ? 0.6 : 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>Date</TableCell>
            {showMember && <TableCell>Member</TableCell>}
            <TableCell>Membership</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell>Mode</TableCell>
            <TableCell>Reference</TableCell>
            <TableCell>Recorded by</TableCell>
            {onVoid && <TableCell align="right">Actions</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {payments.map((p) => (
            <TableRow key={p.id} sx={p.voided ? { bgcolor: 'action.hover' } : undefined} data-voided={p.voided ? 'true' : undefined}>
              <TableCell>{formatIstDate(p.paymentDate)}</TableCell>
              {showMember && (
                <TableCell>
                  <RouterLink to={memberProfilePath(p.memberDocId)}>{p.memberDisplayName}</RouterLink>
                  <br />
                  <span style={{ fontSize: 12, opacity: 0.7 }}>{p.memberId}</span>
                </TableCell>
              )}
              <TableCell>{membershipLabel?.(p.membershipId) ?? `…${p.membershipId.slice(-6)}`}</TableCell>
              <TableCell align="right">
                <Box component="span" sx={{ textDecoration: p.voided ? 'line-through' : 'none' }}>
                  {formatInr(p.amountPaise)}
                </Box>
                {p.voided && <Chip size="small" color="error" label="VOID" sx={{ ml: 1 }} />}
              </TableCell>
              <TableCell>{PAYMENT_METHOD_LABELS[p.method]}</TableCell>
              <TableCell sx={{ wordBreak: 'break-word' }}>
                {p.transactionReference ?? '—'}
                {p.notes && (
                  <Typography variant="caption" color="text.secondary" component="div">
                    {p.notes}
                  </Typography>
                )}
                {p.voided && (
                  <Typography variant="caption" color="error" component="div">
                    Voided{p.voidedAt ? ` ${formatIstDate(p.voidedAt)}` : ''}: {p.voidReason ?? 'no reason recorded'}
                  </Typography>
                )}
              </TableCell>
              <TableCell>{p.createdByName || '—'}</TableCell>
              {onVoid && (
                <TableCell align="right">
                  {!p.voided && (
                    <Button size="small" color="error" onClick={() => onVoid(p)}>
                      Void
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
