import { ThemeProvider } from '@mui/material';
import { render } from '@testing-library/react';
import { type ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../context/ToastContext';
import { fromCivilDate } from '../domain/dates';
import { theme } from '../theme';
import { type Member } from '../types/member';

/** Render a page inside theme + toast + router; `path` is the route pattern, `url` the location. */
export function renderPage(ui: ReactElement, { path = '/', url = '/' }: { path?: string; url?: string } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

export function makeMember(over: Partial<Member> = {}): Member {
  return {
    id: 'doc1',
    memberId: 'GYM-2026-0001',
    memberIdYear: 2026,
    firstName: 'Rahul',
    lastName: 'Sharma',
    displayName: 'Rahul Sharma',
    gender: 'MALE',
    dateOfBirth: fromCivilDate(1995, 5, 10),
    mobile: '9876543210',
    email: null,
    address: null,
    emergencyContact: null,
    trainerId: null,
    trainerName: null,
    joiningDate: fromCivilDate(2026, 1, 15),
    generalNotes: null,
    hasPhoto: false,
    suspended: false,
    suspendedAt: null,
    suspendedReason: null,
    deleted: false,
    hasMembership: false,
    membership: { membershipId: null, planId: null, planName: null, startDate: null, endDate: null, amountPaise: null },
    pendingPaise: 0,
    consent: { given: true, at: new Date('2026-01-15T10:00:00Z'), byUid: 'u1', byName: 'Owner', version: 'consent-v1', guardianConsent: false },
    createdAt: new Date('2026-01-15T10:00:00Z'),
    createdBy: 'u1',
    updatedAt: new Date('2026-01-15T10:00:00Z'),
    updatedBy: 'u1',
    version: '1.0',
    ...over,
  };
}
