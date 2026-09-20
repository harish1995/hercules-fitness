/**
 * READ-ONLY drift check (architecture 2.7, R-2). Recomputes every denormalized total from the source of truth (payments +
 * memberships) and reports what does not match. It NEVER writes and never repairs anything; exit code 1 = drift found.
 *
 * Emulator (local, after `npm run seed` or your own testing):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run reconcile
 *
 * A real project. There is no service account and no Admin SDK in this repo, so the script signs in as an ADMIN of the app
 * (the rules let an Admin read payments and deleted members). Reading is billed: one read per member + membership + payment +
 * counter document, so it needs --yes and you should run it rarely (see the README, "Reconcile"):
 *
 *   set -a; . ./.env.local; set +a          # the five VITE_FIREBASE_* values of the project to check
 *   RECONCILE_EMAIL=owner@example.com RECONCILE_PASSWORD='...' npm run reconcile -- --yes
 *
 * The password is only ever read from the environment (never an argument, so it does not land in shell history or `ps`), is used
 * for one sign-in and is never printed. The report contains ids, paise and dates only: no names, mobile numbers or notes.
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { formatReport, reconcile } from '../src/domain/reconcile';
import { readReconcileInput } from '../src/services/reconcileQueries';
import { SEED_PROJECT_ID } from './seedGuard';
import { assertReconcileTarget } from './reconcileGuard';

function progress(collectionName: string, total: number) {
  process.stdout.write(`\r  read ${total} ${collectionName}        `);
}

async function checkAndPrint(db: Firestore) {
  const input = await readReconcileInput(db, { onPage: progress });
  process.stdout.write('\n');
  const report = reconcile(input);
  for (const line of formatReport(report)) console.log(line);
  process.exitCode = report.errors > 0 ? 1 : 0;
}

async function main() {
  const target = assertReconcileTarget(process.env, process.argv.slice(2));

  if (target.kind === 'emulator') {
    console.log(`Reading the Firestore emulator at ${target.host}:${target.port} (read-only).`);
    const env = await initializeTestEnvironment({ projectId: SEED_PROJECT_ID, firestore: { host: target.host, port: target.port } });
    try {
      // the emulator only: rules disabled so no seeded Admin is needed. Reads only.
      await env.withSecurityRulesDisabled((ctx) => checkAndPrint(ctx.firestore() as unknown as Firestore));
    } finally {
      await env.cleanup();
    }
    return;
  }

  console.log(`Reading project ${target.projectId} as ${target.email} (read-only; billed reads).`);
  const app = initializeApp(target.config);
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, target.email, target.password);
  try {
    await checkAndPrint(getFirestore(app));
  } finally {
    await auth.signOut();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : 'Reconcile failed.'); // never print the error object: a sign-in error could echo the email
    process.exit(2);
  },
);
