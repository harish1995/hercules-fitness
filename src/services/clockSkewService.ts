import { auth } from '../firebase/app';
import { clockSkewMs } from '../domain/clockSkew';

/**
 * Measure how far the device clock is from the server clock, with ZERO Firestore reads (architecture 6.6, R-3).
 *
 * Deviation from the architecture text, which compares a server-resolved `serverTimestamp()` value after a write: the web SDK returns
 * no commit time from a transaction, so that needs a read-back of the written document (one extra billed read per write), which the
 * design forbids. Instead this uses a value the SERVER stamps for free: the `iat` (issued-at) of a freshly minted Firebase Auth ID
 * token. A token refresh is forced first, so `iat` is "now" on Google's clock (a cached token can be up to an hour old, which would be
 * indistinguishable from a wrong clock). The refresh is one Auth (securetoken) request, not a Firestore read. `iat` has one-second
 * resolution, well below the 5-minute threshold.
 *
 * Returns null when nobody is signed in or the measurement fails (offline etc.): a failed measurement never raises a false warning.
 * Nothing is logged or stored.
 */
export async function measureClockSkewMs(): Promise<number | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    await user.getIdToken(true);
    const result = await user.getIdTokenResult();
    const issuedAt = new Date(result.issuedAtTime);
    if (Number.isNaN(issuedAt.getTime())) return null;
    return clockSkewMs(issuedAt, new Date());
  } catch {
    return null;
  }
}
