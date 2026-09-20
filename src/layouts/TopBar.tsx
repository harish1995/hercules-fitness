import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import { AppBar, Box, Button, Chip, IconButton, Toolbar, Typography } from '@mui/material';
import { useState } from 'react';
import { ROLE_LABELS } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { toUserMessage } from '../services/errors';
import { SIDEBAR_WIDTH } from './Sidebar';

interface TopBarProps {
  onMenuClick: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { user, role, signOut } = useAuth();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = async () => {
    setSigningOut(true);
    try {
      await signOut();
      // RequireAuth redirects to /login as soon as the signed-out state arrives.
    } catch (e) {
      toast.error(toUserMessage(e));
      setSigningOut(false);
    }
  };

  const name = user?.displayName || user?.email || 'User';

  return (
    <AppBar
      position="fixed"
      color="inherit"
      elevation={0}
      sx={{
        borderBottom: 1,
        borderColor: 'divider',
        width: { md: `calc(100% - ${SIDEBAR_WIDTH}px)` },
        ml: { md: `${SIDEBAR_WIDTH}px` },
      }}
    >
      <Toolbar>
        <IconButton
          edge="start"
          aria-label="Open navigation menu"
          onClick={onMenuClick}
          sx={{ mr: 1, display: { md: 'none' } }}
        >
          <MenuIcon />
        </IconButton>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, display: { md: 'none' } }} noWrap>
          Hercules Fitness
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="body2" noWrap sx={{ mr: 1.5, maxWidth: 220, display: { xs: 'none', sm: 'block' } }}>
          {name}
        </Typography>
        {role && <Chip label={ROLE_LABELS[role]} size="small" color="primary" variant="outlined" sx={{ mr: 1 }} />}
        <Button
          color="inherit"
          onClick={() => {
            void handleLogout();
          }}
          disabled={signingOut}
          startIcon={<LogoutIcon />}
        >
          Logout
        </Button>
      </Toolbar>
    </AppBar>
  );
}
