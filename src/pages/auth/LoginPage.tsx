import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, CircularProgress, Link, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link as RouterLink, Navigate, useSearchParams } from 'react-router-dom';
import { NEXT_PARAM, ROUTES } from '../../constants/routes';
import { loginSchema, type LoginFormValues } from '../../domain/validation/auth';
import { useAuth } from '../../hooks/useAuth';
import { resolvePostLoginPath } from '../../routes/nextPath';
import { toUserMessage } from '../../services/errors';

export function LoginPage() {
  const { state, signIn } = useAuth();
  const [searchParams] = useSearchParams();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  // Already signed in (or just signed in): go where the user was headed.
  if (state.status === 'ready') {
    return <Navigate to={resolvePostLoginPath(searchParams.get(NEXT_PARAM), state.role)} replace />;
  }

  // handleSubmit only invokes this when validation passed, so invalid input makes no network call (US-1.1c).
  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    try {
      await signIn(values.email, values.password);
      // Success: AuthProvider resolves the role and this page redirects (or the refusal screen shows).
    } catch (e) {
      // Form values are kept so the user can retry (US-1.1e).
      setSubmitError(toUserMessage(e));
    }
  };

  return (
    <Box component="form" noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)}>
      <Typography variant="h6" component="h1" sx={{ mb: 2 }}>
        Sign in
      </Typography>
      <Stack spacing={2}>
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
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={Boolean(errors.password)}
          helperText={errors.password?.message}
          {...register('password')}
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={isSubmitting}
          startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : undefined}
        >
          Sign in
        </Button>
        <Link component={RouterLink} to={ROUTES.forgotPassword} variant="body2" sx={{ alignSelf: 'center' }}>
          Forgot password?
        </Link>
      </Stack>
    </Box>
  );
}
