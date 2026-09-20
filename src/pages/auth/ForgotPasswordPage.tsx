import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, CircularProgress, Link, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link as RouterLink } from 'react-router-dom';
import { ROUTES } from '../../constants/routes';
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '../../domain/validation/auth';
import { useAuth } from '../../hooks/useAuth';
import { mapFirebaseError } from '../../services/errors';

/** Same wording whether or not the account exists, so the page cannot be used to probe emails (US-1.4a). */
const GENERIC_CONFIRMATION = 'If an account exists for that email, a reset link has been sent.';

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    setSubmitError(null);
    setConfirmed(false); // a retry must not keep showing an earlier confirmation
    try {
      await sendPasswordReset(values.email);
      setConfirmed(true);
    } catch (e) {
      const error = mapFirebaseError(e);
      // Only "this address is not a usable account" outcomes (user-not-found, invalid-email,
      // user-disabled: all INVALID_CREDENTIALS) collapse into the generic confirmation, so the page
      // cannot be used to probe accounts. Any other failure (network, throttling, UNKNOWN, ...) did
      // not send anything, so it must never look like success: show the error with retry.
      if (error.kind === 'INVALID_CREDENTIALS') {
        setConfirmed(true);
      } else {
        setSubmitError(error.userMessage);
      }
    }
  };

  return (
    <Box component="form" noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)}>
      <Typography variant="h6" component="h1" sx={{ mb: 0.5 }}>
        Reset your password
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Enter your email and we will send you a link to reset your password.
      </Typography>
      <Stack spacing={2}>
        {confirmed && <Alert severity="success">{GENERIC_CONFIRMATION}</Alert>}
        {submitError && <Alert severity="error">{submitError}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          autoFocus
          error={Boolean(errors.email)}
          helperText={errors.email?.message}
          {...register('email')}
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={isSubmitting}
          startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : undefined}
        >
          {submitError ? 'Try again' : 'Send reset link'}
        </Button>
        <Link component={RouterLink} to={ROUTES.login} variant="body2" sx={{ alignSelf: 'center' }}>
          Back to sign in
        </Link>
      </Stack>
    </Box>
  );
}
