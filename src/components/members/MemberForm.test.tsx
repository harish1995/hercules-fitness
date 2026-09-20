import { ThemeProvider } from '@mui/material';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { toDayInputValue } from '../../domain/dates';
import { EMPTY_MEMBER_FORM, type MemberFormValues } from '../../domain/validation/member';
import { AppError, DuplicateMobileError } from '../../services/errors';
import { theme } from '../../theme';
import { MemberForm } from './MemberForm';

const today = toDayInputValue(new Date());
const validEditDefaults: Partial<MemberFormValues> = {
  firstName: 'Rahul', lastName: 'Sharma', gender: 'MALE', dateOfBirth: '1995-05-10', joiningDate: today, consent: true,
};

function setup(over: Partial<Parameters<typeof MemberForm>[0]> = {}, defaults: Partial<MemberFormValues> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const checkMobile = vi.fn().mockResolvedValue(null);
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <MemberForm
          mode="create"
          defaultValues={{ ...EMPTY_MEMBER_FORM, joiningDate: today, ...defaults }}
          trainers={[]}
          canEditMedical
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          checkMobile={checkMobile}
          submitLabel="Register member"
          {...over}
        />
      </MemoryRouter>
    </ThemeProvider>,
  );
  return { onSubmit, checkMobile };
}

async function fillValid(opts: { dob?: string } = {}) {
  await userEvent.type(screen.getByLabelText(/First name/), '  Rahul ');
  await userEvent.type(screen.getByLabelText(/Last name/), 'Sharma');
  await userEvent.click(screen.getByRole('combobox', { name: /Gender/ }));
  await userEvent.click(await screen.findByRole('option', { name: 'Male' }));
  fireEvent.change(screen.getByLabelText(/Date of birth/), { target: { value: opts.dob ?? '1995-05-10' } });
  await userEvent.type(screen.getByLabelText(/^Mobile \*/), '+91 98765 43210');
}

describe('MemberForm validation (US-2.4)', () => {
  it('blocks an empty submit, shows a message per required field and never calls onSubmit', async () => {
    const { onSubmit } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Register member' }));
    expect(await screen.findByText('First name is required')).toBeInTheDocument();
    expect(screen.getByText('Last name is required')).toBeInTheDocument();
    expect(screen.getByText('Date of birth is required')).toBeInTheDocument();
    expect(screen.getByText('Mobile number is required')).toBeInTheDocument();
    expect(screen.getByText('Consent is required to register a member')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a bad mobile, a bad email, a future DOB and a half-filled emergency contact', async () => {
    const { onSubmit } = setup();
    await fillValid({ dob: '2999-01-01' });
    await userEvent.clear(screen.getByLabelText(/^Mobile \*/));
    await userEvent.type(screen.getByLabelText(/^Mobile \*/), '12345');
    await userEvent.type(screen.getByLabelText(/^Email/), 'nope');
    await userEvent.type(screen.getByLabelText(/^Name$/), 'Sita');
    await userEvent.click(screen.getByRole('button', { name: 'Register member' }));
    expect(await screen.findByText(/valid 10-digit mobile/)).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Date of birth cannot be in the future')).toBeInTheDocument();
    expect(screen.getByText('Emergency contact mobile number is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits valid values (raw form strings; consent ticked) exactly once', async () => {
    const { onSubmit } = setup();
    await fillValid();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Register member' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      firstName: 'Rahul', // trimmed
      lastName: 'Sharma',
      gender: 'MALE',
      dateOfBirth: '1995-05-10',
      mobile: '+91 98765 43210',
      consent: true,
    });
  });

  it('without `plans` (Staff / edit) there is no plan section and no payment input; the note says only an Admin assigns a plan', () => {
    setup();
    expect(screen.queryByLabelText(/^plan/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/amount paid|payment/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Only an Admin can assign a plan/)).toBeInTheDocument();
  });

  it('with `plans` (Admin registration) a plan and start date show the calculated end date; the Payment section shows the total and a computed pending amount (US-4.2a)', async () => {
    setup({ plans: [{ id: 'p1', name: 'Monthly', durationValue: 1, durationUnit: 'MONTHS', pricePaise: 150000, description: null, active: true, createdAt: new Date(), updatedAt: new Date() }] });
    expect(screen.queryByRole('region', { name: 'Payment' })).not.toBeInTheDocument(); // only once a plan is chosen
    await userEvent.click(screen.getByRole('combobox', { name: 'Plan' }));
    await userEvent.click(await screen.findByRole('option', { name: /Monthly/ }));
    fireEvent.change(screen.getByLabelText(/Membership start date/), { target: { value: '2026-01-31' } });
    expect(screen.getByLabelText('End date')).toHaveValue('27/02/2026'); // month-end rule: 31/01 + 1 month - 1 day
    const payment = screen.getByRole('region', { name: 'Payment' });
    expect(within(payment).getByLabelText('Total amount')).toHaveValue('₹1,500.00');
    expect(within(payment).getByLabelText('Pending amount')).toHaveValue('₹1,500.00');
    await userEvent.type(within(payment).getByLabelText(/Amount paid/), '500');
    expect(within(payment).getByLabelText('Pending amount')).toHaveValue('₹1,000.00'); // display only, updates as you type
    // no card data is ever collected: there is no card number / expiry / CVV input
    expect(screen.queryByLabelText(/card number|cvv|expiry/i)).not.toBeInTheDocument();
  });
});

describe('under 18 and consent (US-2.7)', () => {
  const minorDob = `${new Date().getFullYear() - 10}-06-15`;

  it('shows the Under 18 notice, requires the guardian and words the consent as guardian consent', async () => {
    const { onSubmit } = setup();
    await fillValid({ dob: minorDob });
    expect(screen.getByText(/Under 18: the guardian/)).toBeInTheDocument();
    expect(screen.getByLabelText(/I am the parent or legal guardian/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Register member' }));
    expect(await screen.findByText('Guardian name is required')).toBeInTheDocument();
    expect(screen.getByText('Guardian mobile number is required')).toBeInTheDocument();
    expect(screen.getByText('Guardian consent is required for a member under 18')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('an adult sees the ordinary consent and no notice', async () => {
    setup();
    await fillValid();
    expect(screen.queryByText(/Under 18: the guardian/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/I consent to Hercules Fitness/)).toBeInTheDocument();
  });

  it('edit mode does not ask for consent again', () => {
    setup({ mode: 'edit', submitLabel: 'Save changes' });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('medical notes are Admin-only (US-2.6b)', () => {
  it('the field is rendered for Admin and absent for Staff', () => {
    setup({ canEditMedical: true });
    expect(screen.getByLabelText(/Medical notes/)).toBeInTheDocument();
  });
  it('is not rendered at all when the user cannot edit medical notes', () => {
    setup({ canEditMedical: false });
    expect(screen.queryByLabelText(/Medical/i)).not.toBeInTheDocument();
  });
});

describe('duplicate mobile is a WARNING that needs an explicit confirmation (NEW-14)', () => {
  const sita = { memberDocId: 'doc9', memberId: 'GYM-2026-0009', displayName: 'Sita Devi', deleted: false };

  it('a duplicate found on blur is a warning (not an error) naming the member with a link; submit is gated until "register anyway" is ticked', async () => {
    const { checkMobile, onSubmit } = setup();
    checkMobile.mockResolvedValue(sita);
    await fillValid();
    await userEvent.click(screen.getByRole('checkbox', { name: /I consent/ }));
    await userEvent.tab();
    const warning = await screen.findByText(/already registered to/);
    expect(warning.closest('[role="alert"]')).toHaveClass('MuiAlert-colorWarning');
    expect(checkMobile).toHaveBeenCalledWith('9876543210'); // normalized before the lookup
    expect(screen.getByRole('link', { name: 'Sita Devi (GYM-2026-0009)' })).toHaveAttribute('href', '/members/doc9');
    expect(screen.getByRole('button', { name: 'Register member' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Register anyway/ }));
    expect(screen.getByRole('button', { name: 'Register member' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Register member' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ duplicateMobileConfirmed: true });
  });

  it('without a duplicate the confirmation flag is false', async () => {
    const { onSubmit } = setup();
    await fillValid();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Register member' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ duplicateMobileConfirmed: false });
  });

  it('a duplicate reported by the save-time check shows the same warning, asks for confirmation and nothing is lost', async () => {
    const { onSubmit } = setup();
    onSubmit.mockRejectedValueOnce(new DuplicateMobileError(sita));
    await fillValid();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Register member' }));
    expect(await screen.findByText(/already registered to/)).toBeInTheDocument();
    expect((screen.getByLabelText(/First name/) as HTMLInputElement).value.trim()).toBe('Rahul');
    expect(screen.getByRole('button', { name: 'Register member' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Register anyway/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Register member' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[1]).toEqual({ duplicateMobileConfirmed: true });
  });

  it('a soft-deleted owner is named as deleted, needs no confirmation and does not gate submit (US-2.3c)', async () => {
    const { checkMobile } = setup();
    checkMobile.mockResolvedValue({ ...sita, deleted: true });
    await userEvent.type(screen.getByLabelText(/^Mobile \*/), '9876543210');
    await userEvent.tab();
    expect(await screen.findByText(/belonged to a deleted member \(Sita Devi, GYM-2026-0009\)/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Register anyway/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register member' })).toBeEnabled();
  });

  it('a lookup failure does not block the user (the save path checks again)', async () => {
    const { checkMobile } = setup();
    checkMobile.mockRejectedValue(new Error('offline'));
    await userEvent.type(screen.getByLabelText(/^Mobile \*/), '9876543210');
    await userEvent.tab();
    await waitFor(() => expect(checkMobile).toHaveBeenCalled());
    expect(screen.queryByText(/already registered to/)).not.toBeInTheDocument();
  });

  it("editing: a member's own number is not a duplicate, and an UNCHANGED number is not even looked up", async () => {
    const { checkMobile } = setup(
      { mode: 'edit', ownMemberDocId: 'doc1', submitLabel: 'Save changes' },
      { mobile: '9876543210' },
    );
    checkMobile.mockResolvedValue({ ...sita, memberDocId: 'other' });
    await userEvent.click(screen.getByLabelText(/^Mobile \*/));
    await userEvent.tab();
    expect(checkMobile).not.toHaveBeenCalled();
    expect(screen.queryByText(/already registered to/)).not.toBeInTheDocument();
  });

  it('editing: changing to a number another member has warns and passes the confirmation ("save anyway")', async () => {
    const { checkMobile, onSubmit } = setup(
      { mode: 'edit', ownMemberDocId: 'doc1', submitLabel: 'Save changes' },
      { ...validEditDefaults, mobile: '9876543210' },
    );
    checkMobile.mockResolvedValue(sita);
    await userEvent.clear(screen.getByLabelText(/^Mobile \*/));
    await userEvent.type(screen.getByLabelText(/^Mobile \*/), '9123456780');
    await userEvent.tab();
    expect(await screen.findByText(/already registered to/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Save anyway/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ duplicateMobileConfirmed: true });
  });
});

describe('failure handling (US-2.1c, US-2.10d)', () => {
  it('keeps the entered values and shows a retryable friendly message', async () => {
    const { onSubmit } = setup();
    onSubmit.mockRejectedValue(new AppError('NETWORK'));
    await fillValid();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Register member' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error. Check your internet connection and try again.');
    expect((screen.getByLabelText(/First name/) as HTMLInputElement).value.trim()).toBe('Rahul');
    expect(screen.getByRole('button', { name: 'Register member' })).toBeEnabled(); // can retry
  });

  it('disables submit while a save is in flight (no double submit, US-2.1d)', async () => {
    const { onSubmit } = setup();
    let finish: () => void = () => undefined;
    onSubmit.mockReturnValue(new Promise<void>((r) => (finish = r)));
    await fillValid();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Register member' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Register member' })); // even a forced second submit
    expect(onSubmit).toHaveBeenCalledTimes(1);
    finish();
  });

  it('a CONFLICT offers to reload the record', async () => {
    const onReload = vi.fn();
    const { onSubmit } = setup({ mode: 'edit', submitLabel: 'Save changes', onReload });
    onSubmit.mockRejectedValue(new AppError('CONFLICT'));
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reload record' }));
    expect(onReload).toHaveBeenCalled();
  });
});
