import { Box, Toolbar } from '@mui/material';
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ClockSkewBanner } from '../components/feedback/ClockSkewBanner';
import { useAuth } from '../hooks/useAuth';
import { useClockSkew } from '../hooks/useClockSkew';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** The signed-in shell: sidebar + top bar around the routed page. */
export function AppLayout() {
  const { role } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const clockSkewMs = useClockSkew();

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <TopBar onMenuClick={() => setMobileOpen(true)} />
      <Sidebar role={role} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
        <Toolbar />
        <ClockSkewBanner skewMs={clockSkewMs} />
        <Outlet />
      </Box>
    </Box>
  );
}
