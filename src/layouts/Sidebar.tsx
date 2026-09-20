import AssessmentIcon from '@mui/icons-material/Assessment';
import CardMembershipIcon from '@mui/icons-material/CardMembership';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import PaymentsIcon from '@mui/icons-material/Payments';
import PeopleIcon from '@mui/icons-material/People';
import SettingsIcon from '@mui/icons-material/Settings';
import SportsGymnasticsIcon from '@mui/icons-material/SportsGymnastics';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material';
import { type ElementType } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { navItemsForRole, type NavIconKey } from '../constants/navigation';
import { type Role } from '../constants/roles';

export const SIDEBAR_WIDTH = 240;

const ICONS: Record<NavIconKey, ElementType> = {
  dashboard: DashboardIcon,
  members: PeopleIcon,
  plans: CardMembershipIcon,
  payments: PaymentsIcon,
  attendance: EventAvailableIcon,
  trainers: SportsGymnasticsIcon,
  reports: AssessmentIcon,
  settings: SettingsIcon,
};

interface SidebarProps {
  role: Role | null;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function NavList({ role, onNavigate }: { role: Role | null; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const items = navItemsForRole(role);

  return (
    <Box component="nav" aria-label="Main navigation">
      <Toolbar sx={{ gap: 1 }}>
        <FitnessCenterIcon color="primary" />
        <Typography variant="subtitle1" color="primary" sx={{ fontWeight: 700 }}>
          Hercules Fitness
        </Typography>
      </Toolbar>
      <List sx={{ px: 1 }}>
        {items.map((item) => {
          const Icon = ICONS[item.iconKey];
          const selected = pathname === item.path || pathname.startsWith(`${item.path}/`);
          return (
            <ListItemButton
              key={item.key}
              component={NavLink}
              to={item.path}
              selected={selected}
              onClick={onNavigate}
              sx={{ borderRadius: 1, mb: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Icon fontSize="small" color={selected ? 'primary' : 'inherit'} />
              </ListItemIcon>
              <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontWeight: selected ? 600 : 400 } } }} />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}

/** Permanent drawer from `md` up; a temporary drawer opened from the top bar below it. */
export function Sidebar({ role, mobileOpen, onMobileClose }: SidebarProps) {
  return (
    <Box component="aside" sx={{ width: { md: SIDEBAR_WIDTH }, flexShrink: { md: 0 } }}>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <NavList role={role} onNavigate={onMobileClose} />
      </Drawer>
      <Drawer
        variant="permanent"
        open
        sx={{
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <NavList role={role} />
      </Drawer>
    </Box>
  );
}
