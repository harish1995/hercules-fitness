import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import { Alert, Avatar, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import { PHOTO_ACCEPTED_TYPES } from '../../domain/photo';
import { type MemberPhoto } from '../../types/member';
import { compressPhoto, PhotoError } from '../../utils/photoCompress';

interface PhotoPickerProps {
  value: MemberPhoto | null;
  onChange: (photo: MemberPhoto | null) => void;
  disabled?: boolean;
  label?: string;
  /** Show "Remove" (default true). The profile passes false unless the user may delete the stored photo. */
  allowRemove?: boolean;
}

/** Choose a photo: type/size validated and the image compressed to ~100 KB in the browser before anything is stored. */
export function PhotoPicker({ value, onChange, disabled, label = 'Profile photo (optional)', allowRemove = true }: PhotoPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await compressPhoto(file));
    } catch (e) {
      // A refused photo never blocks the form: it simply stays without one (US-2.5c).
      setError(e instanceof PhotoError ? e.message : 'This image could not be processed. Choose a different photo.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Avatar src={value?.dataUrl} alt="Photo preview" sx={{ width: 72, height: 72 }} variant="rounded" />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={busy ? <CircularProgress size={14} /> : <PhotoCameraOutlinedIcon />}
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
          >
            {value ? 'Change photo' : 'Choose photo'}
          </Button>
          {value && allowRemove && (
            <Button size="small" disabled={disabled || busy} onClick={() => onChange(null)}>
              Remove
            </Button>
          )}
        </Stack>
      </Stack>
      <input
        ref={input}
        type="file"
        hidden
        data-testid="photo-input"
        accept={PHOTO_ACCEPTED_TYPES.join(',')}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        JPEG, PNG or WebP up to 5 MB. It is resized and compressed to about 100 KB; location data is removed.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }} role="alert">
          {error}
        </Alert>
      )}
    </Box>
  );
}
