/**
 * Seed v4 (members, trainers, plans, memberships in every status, 10 payments and attendance) for LOCAL DEVELOPMENT ONLY.
 *
 *   npx firebase emulators:start --only auth,firestore     (terminal 1)
 *   npm run seed                                           (terminal 2)
 *
 * Safety (R-7): refuses anything but a loopback Firestore emulator (see seedGuard.ts); never needs or reads a
 * service-account key; project id is the fixed "demo-" id. Members are created through the SAME transaction the app
 * uses (registerMemberTx), acting as a seeded admin under the REAL security rules, so the member-ID counter, consent,
 * audit records and search fields are exactly what the app would write. Plans and memberships go through createPlanTx /
 * assignMembershipTx / renewMembershipTx / setSuspendedTx too, so the denormalized member summary, pendingPaise and the
 * audit trail obey the same invariants. Payments go through the same transactions as the app: a first payment taken with
 * assign / renew, recordPaymentTx (TX-4) and voidPaymentTx (TX-5), so every membership's paid / outstanding and every member's
 * pendingPaise is exactly what the app would have written.
 * Attendance: TODAY's records go through checkInTx / checkOutTx / markAbsentTx as the seeded STAFF user under the real rules
 * (including a refused EXPIRED check-in without confirmation and a refused SUSPENDED check-in, plus a modified-client attempt the
 * rules must refuse). Records for PAST days cannot be written through the rules on purpose (the day comes from the server
 * clock, there is no backdating), so they are written with rules disabled, in exactly the shape the transactions write.
 * Only users/{uid} docs (which no client can write) and those past-day attendance records are written with rules disabled,
 * which only the emulator allows.
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, getDocs, limit, query, serverTimestamp, setDoc, setLogLevel, Timestamp, writeBatch, type Firestore } from 'firebase/firestore';
import { attendanceDocId } from '../src/domain/attendance';
import { addIstDays, formatIstDate, fromCivilDate, istDayKey, toCivilDate, todayIstStart } from '../src/domain/dates';
import { checkInTx, checkOutTx, markAbsentTx } from '../src/services/attendanceTransactions';
import { AttendanceRefusalError } from '../src/services/errors';
import { assignMembershipTx, newMembershipDocId, renewMembershipTx, setSuspendedTx } from '../src/services/membershipTransactions';
import { newPaymentDocId, recordPaymentTx, voidPaymentTx } from '../src/services/paymentTransactions';
import { registerMemberTx } from '../src/services/memberTransactions';
import { createPlanTx, newPlanDocId } from '../src/services/planTransactions';
import { type PlanInput } from '../src/types/membership';
import { type PaymentDetails } from '../src/types/payment';
import { type Actor, type MemberProfileInput } from '../src/types/member';
import { assertSeedTarget, SEED_PROJECT_ID } from './seedGuard';

const SEED_PASSWORD = 'Passw0rd!local'; // Auth EMULATOR only; never a real credential
const ADMIN_EMAIL = 'admin@hercules.test';
const STAFF_EMAIL = 'staff@hercules.test';

async function authEmulatorUid(host: string, port: number, email: string): Promise<string | null> {
  const base = `http://${host}:${port}/identitytoolkit.googleapis.com/v1/accounts`;
  const body = JSON.stringify({ email, password: SEED_PASSWORD, returnSecureToken: true });
  const headers = { 'Content-Type': 'application/json' };
  let res = await fetch(`${base}:signUp?key=fake-api-key`, { method: 'POST', headers, body });
  if (!res.ok) res = await fetch(`${base}:signInWithPassword?key=fake-api-key`, { method: 'POST', headers, body });
  if (!res.ok) return null;
  const json = (await res.json()) as { localId?: string };
  return json.localId ?? null;
}

const ago = (days: number) => addIstDays(todayIstStart(), -days);
const monthsAgo = (months: number, day = 10) => {
  const t = toCivilDate(todayIstStart());
  const total = t.year * 12 + (t.month - 1) - months;
  return fromCivilDate(Math.floor(total / 12), (total % 12) + 1, day);
};

const base: Omit<MemberProfileInput, 'firstName' | 'lastName' | 'mobile' | 'joiningDate'> = {
  gender: 'MALE',
  dateOfBirth: fromCivilDate(1994, 4, 12),
  email: null,
  address: null,
  emergencyContact: null,
  trainerId: null,
  generalNotes: null,
};

async function main() {
  const target = assertSeedTarget(process.env);
  console.log(`Seeding the Firestore emulator at ${target.host}:${target.port} (project ${SEED_PROJECT_ID})`);

  const env = await initializeTestEnvironment({ projectId: SEED_PROJECT_ID, firestore: { host: target.host, port: target.port } });
  try {
    // ---- users (console-only in real life; the emulator lets the seed create them) ----
    let adminUid = 'seed-admin';
    let staffUid = 'seed-staff';
    if (target.authEmulator) {
      adminUid = (await authEmulatorUid(target.authEmulator.host, target.authEmulator.port, ADMIN_EMAIL)) ?? adminUid;
      staffUid = (await authEmulatorUid(target.authEmulator.host, target.authEmulator.port, STAFF_EMAIL)) ?? staffUid;
    }
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      const stamp = { createdAt: new Date() };
      await setDoc(doc(db, 'users', adminUid), { email: ADMIN_EMAIL, displayName: 'Seed Admin', role: 'ADMIN', active: true, ...stamp });
      await setDoc(doc(db, 'users', staffUid), { email: STAFF_EMAIL, displayName: 'Seed Staff', role: 'STAFF', active: true, ...stamp });
    });

    const db = env.authenticatedContext(adminUid).firestore() as unknown as Firestore;
    const admin: Actor = { uid: adminUid, name: 'Seed Admin', role: 'ADMIN' };

    const existing = await getDocs(query(collection(db, 'members'), limit(1)));
    if (!existing.empty) {
      console.log('Members already exist in this emulator: nothing to do (restart the emulator for a clean seed).');
      return;
    }

    // ---- trainers ----
    const trainerIds: string[] = [];
    for (const t of [
      { name: 'Amit Kumar', mobile: '9810000001', active: true },
      { name: 'Priya Singh', mobile: '9810000002', active: true },
      { name: 'Rohan Das', mobile: null, active: false },
    ]) {
      const ref = await addDoc(collection(db, 'trainers'), {
        ...t, createdAt: serverTimestamp(), createdBy: adminUid, updatedAt: serverTimestamp(), updatedBy: adminUid,
      });
      trainerIds.push(ref.id);
    }
    const [amit, priya] = trainerIds;

    // ---- members: dates relative to today so the dashboard chart has data in several months ----
    const people: { first: string; last: string; mobile: string; joined: Date; over?: Partial<MemberProfileInput>; medical?: string; guardian?: boolean }[] = [
      { first: 'Rahul', last: 'Sharma', mobile: '9876543210', joined: monthsAgo(0, 1), over: { trainerId: amit ?? null } },
      { first: 'Sita', last: 'Verma', mobile: '9876500001', joined: ago(3), over: { gender: 'FEMALE', trainerId: priya ?? null } },
      { first: 'Sam', last: 'Verma', mobile: '9876500002', joined: monthsAgo(1) },
      { first: 'Ravi', last: 'Samuel', mobile: '9876500003', joined: monthsAgo(1, 25) },
      { first: 'Samira', last: 'Khan', mobile: '9876500004', joined: monthsAgo(2), over: { gender: 'FEMALE' } },
      { first: 'Anil', last: 'Kapoor', mobile: '9876500005', joined: monthsAgo(3), medical: 'Mild asthma. Keeps an inhaler in the locker.' },
      { first: 'Neha', last: 'Gupta', mobile: '9876500006', joined: monthsAgo(4), over: { gender: 'FEMALE', address: '12 MG Road, Pune' } },
      { first: 'Vikram', last: 'Rao', mobile: '9876500007', joined: monthsAgo(5) },
      { first: 'Meera', last: 'Iyer', mobile: '9876500008', joined: monthsAgo(6), over: { gender: 'FEMALE' } },
      { first: 'Arjun', last: 'Nair', mobile: '9876500009', joined: monthsAgo(8) },
      { first: 'Kabir', last: 'Mehta', mobile: '9876500010', joined: monthsAgo(11) },
      {
        first: 'Tara', last: 'Joshi', mobile: '9876500011', joined: ago(10), guardian: true,
        over: { gender: 'FEMALE', dateOfBirth: addIstDays(todayIstStart(), -365 * 14), emergencyContact: { name: 'Mrs. Joshi', mobile: '9876500099' } },
      },
    ];

    const docIds: Record<string, string> = {};
    const memberIds: Record<string, string> = {};
    for (const p of people) {
      const profile: MemberProfileInput = { ...base, firstName: p.first, lastName: p.last, mobile: p.mobile, joiningDate: p.joined, ...p.over };
      const memberDocId = doc(collection(db, 'members')).id;
      const r = await registerMemberTx({
        db, memberDocId, actor: admin,
        input: { profile, medicalNotes: p.medical ?? null, consentGiven: true, guardianConsent: p.guardian === true },
      });
      docIds[p.first] = memberDocId;
      memberIds[p.first] = r.memberId;
      console.log(`  ${r.memberId}  ${p.first} ${p.last}${p.guardian ? '  (under 18, guardian consent)' : ''}${p.medical ? '  (medical notes)' : ''}`);
    }

    // ---- plans (3): two calendar-month plans and a DAY plan, so any end date can be hit exactly ----
    const planInputs: Record<'monthly' | 'quarterly' | 'pass', PlanInput> = {
      monthly: { name: 'Monthly', durationValue: 1, durationUnit: 'MONTHS', pricePaise: 150000, description: 'One calendar month', active: true },
      quarterly: { name: 'Quarterly', durationValue: 3, durationUnit: 'MONTHS', pricePaise: 400000, description: 'Three calendar months', active: true },
      pass: { name: '10-Day Pass', durationValue: 10, durationUnit: 'DAYS', pricePaise: 60000, description: 'Ten days, inclusive', active: true },
    };
    const planIds = {} as Record<keyof typeof planInputs, string>;
    for (const key of Object.keys(planInputs) as (keyof typeof planInputs)[]) {
      planIds[key] = newPlanDocId(db);
      await createPlanTx({ db, planDocId: planIds[key], input: planInputs[key], actor: admin });
    }

    // ---- memberships: every status incl. the D-4 boundary days, dates relative to TODAY ----
    // The 10-day pass ends exactly `start + 9`, so `passEndingIn(n)` gives an end date of today + n.
    const today = todayIstStart();
    const endingIn = (n: number) => addIstDays(today, n - 9);
    const pay = (amountPaise: number, method: PaymentDetails['method'], daysAgo: number, transactionReference: string | null = null): PaymentDetails => ({
      amountPaise, method, paymentDate: ago(daysAgo), transactionReference, notes: null,
    });
    const assign = (first: string, plan: keyof typeof planIds, startDate: Date, firstPayment?: PaymentDetails) =>
      assignMembershipTx({
        db, memberDocId: docIds[first] as string, planId: planIds[plan], membershipDocId: newMembershipDocId(db), startDate, actor: admin,
        ...(firstPayment ? { firstPayment } : {}),
      });
    const renew = (first: string, plan: keyof typeof planIds, firstPayment?: PaymentDetails) =>
      renewMembershipTx({
        db, memberDocId: docIds[first] as string, planId: planIds[plan], membershipDocId: newMembershipDocId(db), actor: admin,
        ...(firstPayment ? { firstPayment } : {}),
      });
    // a later payment (TX-4) against the member's latest membership: needs its id, so read it back from the assign result
    const payLater = (first: string, membershipId: string, details: PaymentDetails) =>
      recordPaymentTx({ db, paymentDocId: newPaymentDocId(db), memberDocId: docIds[first] as string, membershipId, details, actor: admin });
    const log = (label: string, r: { startDate: Date; endDate: Date }) =>
      console.log(`  ${label.padEnd(58)} ${formatIstDate(r.startDate)} .. ${formatIstDate(r.endDate)}`);

    // 10 payments: full, partial (and completed later), a first payment with a UPI reference, one VOIDED, and old dues that
    // carry forward. Unpaid (no payment) memberships: Sam, Samira, Kabir and Vikram's first one.
    log('Rahul: Monthly, ACTIVE, PAID in full at assignment (cash)', await assign('Rahul', 'monthly', ago(10), pay(150000, 'CASH', 10)));
    const sita = await assign('Sita', 'pass', endingIn(0), pay(20000, 'UPI', 9, 'UPI-SEED-0001'));
    log('Sita: 10-Day Pass ends TODAY (0), partial 200 (UPI)...', sita);
    await payLater('Sita', sita.membershipId, pay(40000, 'CASH', 3)); // ...completed by a later payment
    console.log('    ...Sita then pays the remaining 400 (cash): PAID');
    log('Sam: 10-Day Pass ends in 7 days (EXPIRING_SOON, 7), unpaid', await assign('Sam', 'pass', endingIn(7)));
    const ravi = await assign('Ravi', 'pass', endingIn(8));
    log('Ravi: 10-Day Pass ends in 8 days (ACTIVE, 8), 300 paid', ravi);
    await payLater('Ravi', ravi.membershipId, pay(30000, 'BANK_TRANSFER', 2, 'NEFT-SEED-77'));
    log('Samira: 10-Day Pass ended yesterday (EXPIRED, -1), unpaid', await assign('Samira', 'pass', endingIn(-1)));
    const anil = await assign('Anil', 'quarterly', ago(130));
    log('Anil: Quarterly ended long ago (EXPIRED), 1000 paid', anil);
    await payLater('Anil', anil.membershipId, pay(100000, 'CARD', 120));
    const wrong = await recordPaymentTx({
      db, paymentDocId: newPaymentDocId(db), memberDocId: docIds.Anil as string, membershipId: anil.membershipId, details: pay(50000, 'CASH', 100), actor: admin,
    });
    await voidPaymentTx({ db, paymentId: wrong.paymentId, reason: 'Seed: entered against the wrong member', actor: admin });
    console.log('    ...Anil also has a 500 cash payment that was VOIDED (excluded from totals and revenue)');
    log('Neha: Monthly, PAID (UPI), then SUSPENDED', await assign('Neha', 'monthly', ago(5), pay(150000, 'UPI', 5, 'UPI-SEED-0002')));
    await setSuspendedTx({ db, memberDocId: docIds.Neha as string, suspend: true, reason: 'Seed: travelling', actor: admin });
    // two memberships: the first expired UNPAID (its dues carry forward), so the renewal starts TODAY (the gap is not backfilled)
    await assign('Vikram', 'monthly', ago(45));
    log('Vikram: expired unpaid Monthly + renewed today, paid (2 memberships)', await renew('Vikram', 'monthly', pay(150000, 'CASH', 0)));
    // early renewal STACKS: a pass ending in 3 days, renewed now -> the new period starts the day after
    await assign('Meera', 'pass', endingIn(3));
    log('Meera: pass ending in 3 days + early renewal (stack), 500 paid', await renew('Meera', 'monthly', pay(50000, 'UPI', 1, 'UPI-SEED-0003')));
    log('Arjun: Quarterly, ACTIVE, PAID in full (card)', await assign('Arjun', 'quarterly', ago(20), pay(400000, 'CARD', 20)));
    log('Kabir: pass starting in 5 days (future-dated), unpaid', await assign('Kabir', 'pass', addIstDays(today, 5)));
    console.log('  Tara (under 18): no membership');

    // ---- attendance: ~75 days of history (rules disabled, exact transaction shape), then TODAY through the real transactions ----
    const HISTORY_DAYS = 75;
    const history = people.filter((p) => !['Tara', 'Kabir'].includes(p.first)).map((p) => ({ first: p.first, name: `${p.first} ${p.last}`, joined: p.joined }));
    const pastDocs: { id: string; data: Record<string, unknown> }[] = [];
    history.forEach((h, idx) => {
      for (let back = 1; back <= HISTORY_DAYS; back++) {
        const date = addIstDays(today, -back);
        if (date.getTime() < h.joined.getTime() || (back + idx) % 3 === 0) continue; // not every member comes every day
        const absent = (back * 7 + idx) % 29 === 0; // an occasional explicit ABSENT mark
        const inAt = new Date(date.getTime() + (6 * 60 + ((idx * 37 + back * 11) % 600)) * 60_000);
        const forgot = (back + idx) % 7 === 0; // forgot to check out: stays "not recorded"
        const outAt = absent || forgot ? null : new Date(inAt.getTime() + (45 + ((idx + back) % 60)) * 60_000);
        pastDocs.push({
          id: attendanceDocId(docIds[h.first] as string, date),
          data: {
            memberDocId: docIds[h.first], memberId: memberIds[h.first], memberName: h.name,
            date: Timestamp.fromDate(date), dateKey: istDayKey(date), status: absent ? 'ABSENT' : 'PRESENT',
            checkInAt: absent ? null : Timestamp.fromDate(inAt), checkOutAt: outAt ? Timestamp.fromDate(outAt) : null, checkedOut: outAt !== null,
            createdAt: Timestamp.fromDate(inAt), createdBy: staffUid, updatedAt: Timestamp.fromDate(outAt ?? inAt), updatedBy: staffUid,
          },
        });
      }
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const adb = ctx.firestore() as unknown as Firestore;
      for (let i = 0; i < pastDocs.length; i += 400) {
        const batch = writeBatch(adb);
        for (const d of pastDocs.slice(i, i + 400)) batch.set(doc(adb, 'attendance', d.id), d.data);
        await batch.commit();
      }
    });
    console.log(`  attendance history: ${pastDocs.length} records over the last ${HISTORY_DAYS} days (some forgot to check out, some marked ABSENT)`);

    const staffDb = env.authenticatedContext(staffUid).firestore() as unknown as Firestore;
    const staff: Actor = { uid: staffUid, name: 'Seed Staff', role: 'STAFF' };
    const memberDoc = (first: string) => docIds[first] as string;
    const pause = () => new Promise((resolve) => setTimeout(resolve, 40)); // check-out must be strictly after check-in
    await checkInTx({ db: staffDb, memberDocId: memberDoc('Rahul'), actor: staff });
    await checkInTx({ db: staffDb, memberDocId: memberDoc('Sita'), actor: staff }); // EXPIRING_SOON (0 days): allowed, days shown
    await checkInTx({ db: staffDb, memberDocId: memberDoc('Sam'), actor: staff });
    await checkInTx({ db: staffDb, memberDocId: memberDoc('Ravi'), actor: staff });
    await checkInTx({ db: staffDb, memberDocId: memberDoc('Arjun'), actor: staff });
    await pause();
    await checkOutTx({ db: staffDb, memberDocId: memberDoc('Sita'), actor: staff });
    await checkOutTx({ db: staffDb, memberDocId: memberDoc('Arjun'), actor: staff });
    // NEW-12: EXPIRED needs an explicit confirmation
    try {
      await checkInTx({ db: staffDb, memberDocId: memberDoc('Samira'), actor: staff });
      throw new Error('seed check failed: an EXPIRED member was checked in without confirmation');
    } catch (e) {
      if (!(e instanceof AttendanceRefusalError) || e.reason !== 'NEEDS_CONFIRMATION') throw e;
      console.log(`  Samira (EXPIRED) check-in without confirmation: refused as expected (${e.reason})`);
    }
    await checkInTx({ db: staffDb, memberDocId: memberDoc('Samira'), actor: staff, confirmed: true });
    // NEW-12: SUSPENDED is blocked by the service AND by the rules (a modified client that skips the service)
    try {
      await checkInTx({ db: staffDb, memberDocId: memberDoc('Neha'), actor: staff, confirmed: true });
      throw new Error('seed check failed: a SUSPENDED member was checked in');
    } catch (e) {
      if (!(e instanceof AttendanceRefusalError) || e.reason !== 'SUSPENDED') throw e;
      console.log(`  Neha (SUSPENDED) check-in: blocked by the service (${e.reason})`);
    }
    setLogLevel('silent'); // the SDK logs the (expected) PERMISSION_DENIED stream error below
    try {
      await setDoc(doc(staffDb, 'attendance', attendanceDocId(memberDoc('Neha'), new Date())), {
        memberDocId: memberDoc('Neha'), memberId: memberIds.Neha, memberName: 'Neha Gupta', date: Timestamp.fromDate(today), dateKey: istDayKey(today),
        status: 'PRESENT', checkInAt: serverTimestamp(), checkOutAt: null, checkedOut: false,
        createdAt: serverTimestamp(), createdBy: staffUid, updatedAt: serverTimestamp(), updatedBy: staffUid,
      });
      throw new Error('seed check failed: the rules let a SUSPENDED member be checked in');
    } catch (e) {
      if (!(e instanceof Error) || !/PERMISSION_DENIED|permission/i.test(e.message)) throw e;
      console.log('  Neha (SUSPENDED) raw write bypassing the service: refused by the security rules');
    } finally {
      setLogLevel('warn');
    }
    await markAbsentTx({ db: staffDb, memberDocId: memberDoc('Meera'), actor: staff });
    console.log('  today: Rahul, Sam, Ravi, Samira still checked IN; Sita and Arjun checked in and OUT; Meera marked ABSENT');

    console.log(`\nSeeded ${people.length} members, ${trainerIds.length} trainers, 3 plans, memberships in every status, 10 payments (one voided) and attendance (history + today).`);
    if (target.authEmulator) {
      console.log(`Sign in to the app (VITE_USE_EMULATORS=true) as ${ADMIN_EMAIL} / ${SEED_PASSWORD} (Admin) or ${STAFF_EMAIL} (Staff; refused by the app until Staff login is enabled, see README).`);
    } else {
      console.log('Auth emulator not detected (FIREBASE_AUTH_EMULATOR_HOST unset): create an Auth user in the emulator UI and a users/{uid} doc, see README.');
    }
  } finally {
    await env.cleanup();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
