import { matchPath } from 'react-router-dom';
import { ROUTE_ACCESS } from '../constants/navigation';
import { type Role } from '../constants/roles';
import { ROUTES } from '../constants/routes';
import { isRoleAllowed } from '../domain/access';

const PUBLIC_PATHS: readonly string[] = [ROUTES.login, ROUTES.forgotPassword];

// Any ASCII control character (including tab/CR/LF) makes a redirect target suspicious.
function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Validate the `?next=` redirect target (US-1.5b). Only same-origin, in-app absolute paths are
 * accepted, which blocks open redirects such as `//evil.com`, `/\evil.com` or `https://evil.com`.
 * Anything else falls back to the dashboard.
 */
export function resolveNextPath(next: string | null | undefined): string {
  if (!next) return ROUTES.dashboard;
  if (!next.startsWith('/')) return ROUTES.dashboard;
  if (next.startsWith('//') || next.includes('\\')) return ROUTES.dashboard;
  if (hasControlChars(next)) return ROUTES.dashboard;
  const pathOnly = next.split(/[?#]/)[0] ?? '';
  if (PUBLIC_PATHS.includes(pathOnly) || pathOnly === ROUTES.root) return ROUTES.dashboard;
  return next;
}

/** The part of a route definition the post-login check needs (ROUTE_ACCESS = sidebar items + nested member routes). */
export interface RouteAccess {
  path: string;
  allow: readonly Role[];
}

/**
 * Where to land after login (US-1.5b): the originally requested page, or the dashboard when that
 * path is unsafe, matches no known route, or is not permitted for `role`. This avoids landing a
 * freshly signed-in user on a 404 or an access-denied screen. Matching is exact (`end: true`), so a
 * future nested route must be added to the route table to be a valid return target.
 */
export function resolvePostLoginPath(
  next: string | null | undefined,
  role: Role | null,
  routes: readonly RouteAccess[] = ROUTE_ACCESS,
): string {
  const target = resolveNextPath(next);
  if (target === ROUTES.dashboard) return target;
  const pathname = target.split(/[?#]/)[0] ?? '';
  const route = routes.find((r) => matchPath({ path: r.path, end: true }, pathname) !== null);
  if (!route || !isRoleAllowed(role, route.allow)) return ROUTES.dashboard;
  return target;
}

/** Build the login URL that remembers where to return to. */
export function buildLoginRedirect(currentPath: string, nextParam: string): string {
  const target = resolveNextPath(currentPath);
  if (target === ROUTES.dashboard) return ROUTES.login;
  return `${ROUTES.login}?${nextParam}=${encodeURIComponent(target)}`;
}
