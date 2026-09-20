# Architecture: Gym Management System

Status: proposed, awaiting confirmation of the open questions in §11.
Inputs: `docs/domain-context.md`, `docs/requirements/gym-management-system-requirements.md` (authoritative), `requirment.md` (source).
Date: 2026-09-19. Single gym, INR, `Asia/Kolkata`, `DD/MM/YYYY`.

Hard constraints taken as given (user decisions): Firebase = **Firestore + Authentication only**. No Storage, no Cloud Functions, no Firebase Hosting, no Admin SDK, no server process. Deployed on **Render as a static site** with an SPA rewrite. Roles from a server-controlled `users/{uid}` document read by Firestore rules. Photos are small compressed images inside a Firestore document. Membership status is computed dynamically; only the `suspended` flag is stored.

---

## 1. Final architecture

### 1.1 Layers

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser (Render static site, Vite build, React 18 + TS strict)  │
│                                                                 │
│  pages/            route-level screens, MUI, no Firebase calls  │
│  components/       presentational + shared UX primitives        │
│  layouts/ routes/  app shell, guards, route table               │
│  context/ hooks/   AuthContext, ToastContext, data hooks        │
│      │                                                          │
│      ▼  (hooks call services; components never import firebase) │
│  services/         the ONLY layer importing firebase/firestore  │
│                    memberService, membershipService,            │
│                    paymentService, attendanceService,           │
│                    planService, trainerService, userService,    │
│                    auditService (internal), reportService,      │
│                    dashboardService, notificationService (stub) │
│      │                                                          │
│      ▼  (services call pure logic + utils, then commit)         │
│  domain/           pure business logic, no I/O:                 │
│                    status, renewal dates, money, search keys,   │
│                    query predicates, CSV building               │
│  utils/ types/ constants/                                       │
│      │                                                          │
│      ▼                                                          │
│  firebase/         initializeApp, getAuth, getFirestore only    │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS (Firebase JS SDK)
              ┌────────────────┴─────────────────┐
              ▼                                  ▼
   Firebase Authentication           Cloud Firestore
   (email/password only)             ├ security rules  ← enforcement layer
                                     ├ transactions    ← integrity layer
                                     └ composite indexes
```

Rule of thumb enforced in review: **a file under `pages/` or `components/` may not import from `firebase/` or `services/firebase*`**; it may import hooks and services' exported functions. Pure logic in `domain/` has zero Firebase imports so it is unit-testable without mocks (NFR-10, NFR-6).

`domain/` is an addition to the folder list in the requirements (`src/{components,pages,layouts,routes,services,firebase,hooks,context,utils,types,constants,theme}`). Rationale: the requirements demand a single shared implementation of status/renewal/predicates used by list, profile, dashboard and reports (US-3.4g). Putting it in `utils/` mixes formatting helpers with business rules. If you prefer to stay literal to the source list, `domain/` can live as `utils/domain/` — naming only, no structural difference.

### 1.2 Data flow (typical write: renew a membership)

1. `RenewMembershipDialog` (page) submits a validated form (React Hook Form + Zod).
2. `useRenewMembership` hook calls `membershipService.renewMembership({ memberDocId, planId, clientMembershipId, initialPaymentPaise, ... })`.
3. The service pre-generates the new document IDs (`doc(collection(db,'memberships'))`) **before** the transaction so a retry is idempotent.
4. `runTransaction`:
   - reads `members/{memberDocId}`, `membershipPlans/{planId}`, the pre-generated `memberships/{newId}` (idempotency guard);
   - computes start/end **inside the transaction** from the freshly read `membership.endDate` using `domain/dates` (FR-5, US-3.6f);
   - writes: new `memberships/{newId}`, optional `payments/{newPaymentId}`, updated `members/{memberDocId}` summary, `auditLogs/{newAuditId}`.
5. Firestore rules validate every document in the commit (role, shape, immutability, cross-document invariants via `getAfter()`).
6. On success the hook invalidates its cached queries and raises a toast with the **final computed dates** (US-3.6f).

Reads follow the mirror path: hook → service → `getDocs` with an explicitly indexed query → typed converter → plain domain objects (Timestamps converted at the boundary only where display needs it; comparisons stay on Timestamps).

### 1.3 Why there is no server component, and the resulting trust model

There is no server because the user's constraints exclude every server option available in this stack (Cloud Functions and Storage require the Blaze plan; no Admin SDK host is being paid for). Consequences:

**What is actually enforced (trustworthy):**
- **Identity**: Firebase Authentication. A client cannot forge `request.auth.uid`.
- **Role**: `users/{uid}.role`, which no client can write (`allow write: if false` on `users`). Role forgery is structurally impossible (AC-12).
- **Shape and immutability**: security rules validate field presence, types, ranges, regexes and `diff().affectedKeys()` on every write. Payments cannot be edited or deleted, membership periods cannot be changed after creation, `memberId` and `createdAt` are immutable, `auditLogs` are create-only.
- **Atomicity**: Firestore transactions. A membership cannot exist without its member-summary update and its audit record, because all of them are in one commit and rules reject partial commits (`getAfter()` checks).
- **Cross-document invariants**: rules use `getAfter()` to check that a payment create is accompanied by exactly the matching `paidPaise` increase on its membership, and that a member create is accompanied by exactly a +1 increment of the year counter. This converts "the client is supposed to do this" into "the database refuses otherwise" for the two highest-risk invariants.
- **Server time**: rules compare `request.time` against `createdAt`/`at`/`paymentDate`, so a wrong or hostile client clock cannot back/forward-date audit records or post future payments.

**What is NOT enforced (accepted risk, R-1):**
- A hostile client that is *already* an authenticated ADMIN can write any rule-valid data. Rules constrain the shape, not the intent. The mitigation is that ADMIN is the gym owner; STAFF is the untrusted-ish role and is denied money, medical notes, member edits and reports by rules.
- Audit completeness is only enforced where a `getAfter()` check is attached (member create/update, membership create, payment create/void). For other actions a modified client could skip the audit record. Documented in FR-13 and accepted.
- **Business logic** (renewal maths, status, month-end rule, search key generation) runs client-side. Rules check `endDate > startDate` and format, not that the end date equals `start + N months − 1 day`. A modified client can create a wrong-but-well-formed membership. Accepted; the same code path is unit-tested and is the only one shipped.
- **"Today"** is the device clock for reads/display (R-3). Rules bound writes with `request.time`, but a skewed clock still shows wrong statuses. Mitigation in §6.6.
- **Uniqueness beyond the counter**: the mobile-duplicate check is a best-effort pre-query (warn mode, NEW-14), not an atomic guarantee.

If the owner later pays for Blaze or a Render Cron worker, the natural first migrations are: (a) member ID allocation and audit writing into a callable/cron with the Admin SDK, (b) custom claims instead of the `users` doc read in rules (removes 1 billed read per query), (c) scheduled expiry notifications. The service layer is the seam: only `services/*` would change.

---

## 2. Firestore data model

### 2.0 Conventions

- **Document IDs**: auto-generated (pre-generated client-side for idempotency) except where a deterministic ID is a correctness feature: `memberPhotos/{memberDocId}`, `memberMedical/{memberDocId}`, `counters/memberId-{YYYY}`, `attendance/{memberDocId}_{YYYYMMDD}`.
- **`memberId` vs `memberDocId`**: the document ID of a member is an auto ID (`members/{memberDocId}`); the human-readable `GYM-2026-0001` is the indexed field `memberId`. Reason: the readable ID is only known *inside* the counter transaction, which would break pre-generated-ID idempotency, and it lets `memberPhotos`/`memberMedical`/`attendance` key off a stable ID. Tradeoff: deep links are `/members/{memberDocId}`, not `/members/GYM-2026-0001`; the readable ID is shown everywhere and is prefix-searchable.
- **Dates**: every field that denotes a *calendar day* (`startDate`, `endDate`, `joiningDate`, `dateOfBirth`, `paymentDate`, attendance `date`) is a Firestore `Timestamp` pinned to **00:00:00.000 Asia/Kolkata of that IST day**. Every field that denotes an *instant* (`createdAt`, `updatedAt`, `checkInAt`, `checkOutAt`, audit `at`) is a real instant, written with `serverTimestamp()` where rules verify it. This single representation rule makes all range queries exact and device-timezone independent (D-1).
- **Money**: stored as **integer paise** in fields suffixed `Paise` (`pricePaise`, `amountPaise`, `paidPaise`, `outstandingPaise`, `pendingPaise`). Rationale: exact arithmetic (D-6: 0.1 + 0.2 must be 0.30), safe `increment()`, safe comparisons in rules, safe `sum()` aggregation. Rupees exist only at the UI/CSV boundary via `formatInr(paise)` / `parseInrToPaise(input)`. TypeScript brand `type Paise = number & { readonly __paise: unique symbol }` prevents mixing. Tradeoff: values in the Firebase console read as 150000 instead of 1500 — documented in the README.
- **Enums** are string unions, mirrored in `constants/` and in the rules regexes.
- Every mutable document carries `createdAt/createdBy/updatedAt/updatedBy`.

### 2.1 Collections overview

| Collection | Doc ID | Purpose | Written by |
|---|---|---|---|
| `users/{uid}` | auth uid | role source of truth | **Firebase console only** (no client writes ever) |
| `members/{memberDocId}` | auto | member profile + denormalized summary | TX-1, TX-6..TX-8 |
| `memberMedical/{memberDocId}` | = member | medical notes (Admin-only) | TX-1, TX-8 |
| `memberPhotos/{memberDocId}` | = member | compressed image, separate doc | photo save (non-transactional) |
| `membershipPlans/{planId}` | auto | plans | TX-10 |
| `memberships/{membershipId}` | auto | one period per assign/renew | TX-2/3, TX-4, TX-5 |
| `payments/{paymentId}` | auto | money received (immutable) | TX-4, TX-5 |
| `attendance/{memberDocId}_{YYYYMMDD}` | deterministic | one record per member per IST day | TX-9 |
| `trainers/{trainerId}` | auto | trainer records | Admin CRUD |
| `counters/memberId-{YYYY}` | deterministic | member ID sequence | TX-1 only |
| `auditLogs/{auditId}` | auto (pre-generated) | append-only trail | every audited TX |
| `notifications/{id}` | auto | Phase 7 type only, no writer in MVP | — |
| `settings/app` | fixed | placeholder settings | Admin |
| `metrics/*` | deterministic | **not used in MVP** — see §5.5 | — |

### 2.2 Document shapes

```ts
// users/{uid} — created manually in the Firebase console (NEW-17). Never written by the app.
interface UserDoc {
  email: string;
  displayName: string;
  role: 'ADMIN' | 'STAFF' | 'MEMBER';
  active: boolean;            // false ⇒ treated as no access
  memberDocId?: string;       // set only for MEMBER logins (future, resolved Q4)
  createdAt: Timestamp;
}
```

```ts
// members/{memberDocId}
interface MemberDoc {
  // identity (immutable after create)
  memberId: string;            // 'GYM-2026-0001'  — unique, immutable
  memberIdYear: number;        // 2026

  // profile
  firstName: string; lastName: string;
  displayName: string;         // 'Rahul Sharma' (derived, for snapshots/snippets)
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth: Timestamp;      // IST day start
  mobile: string;              // normalized: 10 digits, starts 6-9
  email: string | null;
  address: string | null;
  emergencyContact: { name: string; mobile: string } | null;
  trainerId: string | null;
  trainerName: string | null;  // snapshot
  joiningDate: Timestamp;      // IST day start
  generalNotes: string | null; // medical notes are NOT here (§2.4)
  hasPhoto: boolean;           // avoids a memberPhotos read to know if one exists

  // normalized search fields (lowercase, trimmed) — see §5.2
  searchFullName: string;      // 'rahul sharma'
  searchReverseName: string;   // 'sharma rahul'
  searchMobile: string;        // '9876543210'

  // lifecycle flags (the ONLY stored status inputs, FR-4)
  suspended: boolean;
  suspendedAt: Timestamp | null; suspendedReason: string | null; suspendedBy: string | null;
  deleted: boolean;            // soft delete (resolved Q6, D-8)
  deletedAt: Timestamp | null; deletedBy: string | null;

  // denormalized membership summary (D-5: latest end date across all memberships)
  hasMembership: boolean;
  membership: {
    membershipId: string | null;
    planId: string | null;
    planName: string | null;   // snapshot, survives plan deletion
    startDate: Timestamp | null;
    endDate: Timestamp | null; // LATEST end date, IST day start
    amountPaise: number | null;
  };

  // denormalized money (D-7: sum of outstanding across all memberships)
  pendingPaise: number;

  // DPDP consent (FR-16)
  consent: {
    given: true; at: Timestamp; byUid: string; byName: string;
    version: string;           // e.g. 'consent-v1'
    guardianConsent: boolean;  // true when under 18 at registration
  };

  createdAt: Timestamp; createdBy: string;
  updatedAt: Timestamp; updatedBy: string;
  lastAuditId: string;         // id of the audit record for the most recent write (§3.4)
}
```

Note: **no `status` field.** Status is derived everywhere from `membership.endDate` + `suspended` + `hasMembership` (FR-4, resolved Q1c). No daily mass write exists.

```ts
// memberships/{membershipId}
interface MembershipDoc {
  memberDocId: string;
  memberId: string;            // readable ID snapshot (for reports/CSV without a join)
  memberDisplayName: string;   // snapshot
  planId: string;
  planName: string;            // snapshot (FR-3: plan edits never change history)
  planDurationValue: number;
  planDurationUnit: 'DAYS' | 'MONTHS';
  startDate: Timestamp;        // IST day start, immutable
  endDate: Timestamp;          // IST day start, inclusive (D-2), immutable
  amountPaise: number;         // plan price snapshot (NEW-3), immutable
  paidPaise: number;           // denormalized, only mutable pair
  outstandingPaise: number;    // = amountPaise - paidPaise, always ≥ 0
  unpaid: boolean;             // outstandingPaise > 0 (index-friendly equality flag)
  createdAt: Timestamp; createdBy: string;
  updatedAt: Timestamp; updatedBy: string;
  lastAuditId: string;
}
```

```ts
// payments/{paymentId} — immutable except the one-way void (NEW-9)
interface PaymentDoc {
  memberDocId: string;
  memberId: string;            // snapshot
  memberDisplayName: string;   // snapshot (revenue CSV without joins; kept even if member soft-deleted)
  membershipId: string;
  amountPaise: number;         // > 0
  paymentDate: Timestamp;      // IST day start, ≤ today (NEW-5)
  method: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';   // no card data ever
  transactionReference: string | null;
  notes: string | null;
  voided: boolean;             // false on create; one-way flip to true
  voidReason: string | null; voidedAt: Timestamp | null; voidedBy: string | null;
  createdAt: Timestamp;        // == request.time (rules-enforced)
  createdBy: string;           // == request.auth.uid (rules-enforced)
  createdByName: string;
  lastAuditId: string;
}
```

```ts
// attendance/{memberDocId}_{YYYYMMDD}  — deterministic ID = one record per member per IST day (Q9)
interface AttendanceDoc {
  memberDocId: string;
  memberId: string;            // snapshot
  memberName: string;          // snapshot (FR-7)
  date: Timestamp;             // IST day start
  dateKey: string;             // 'YYYYMMDD' (IST) — mirrors the doc id, useful in exports
  status: 'PRESENT' | 'ABSENT';
  checkInAt: Timestamp | null;
  checkOutAt: Timestamp | null;
  checkedOut: boolean;         // equality flag for the "currently checked-in" count
  createdAt: Timestamp; createdBy: string;
  updatedAt: Timestamp; updatedBy: string;
}
```

The deterministic ID is what makes US-5.1b true without a transaction: two staff clicking at the same moment both issue a `create`, and rules `allow create: if !exists(...)` / the SDK's create semantics mean exactly one wins.

```ts
// membershipPlans/{planId}
interface PlanDoc {
  name: string; nameLower: string;    // uniqueness check is a pre-query on nameLower
  durationValue: number;              // positive integer
  durationUnit: 'DAYS' | 'MONTHS';
  pricePaise: number;                 // > 0
  description: string | null;
  active: boolean;
  createdAt: Timestamp; createdBy: string; updatedAt: Timestamp; updatedBy: string;
}

// trainers/{trainerId}
interface TrainerDoc { name: string; mobile: string | null; active: boolean; createdAt; createdBy; updatedAt; updatedBy }
```

### 2.3 Counter document and the member-ID transaction

```ts
// counters/memberId-2026
interface MemberIdCounterDoc { year: number; lastSeq: number; updatedAt: Timestamp; updatedBy: string }
```

`TX-1 registerMember` (US-2.2, AC-7):

```
newMemberRef  = doc(collection(db,'members'))        // pre-generated → idempotent retry
newAuditRef   = doc(collection(db,'auditLogs'))
year          = istYear(now)                          // IST year, NOT device year (US-2.2c)
counterRef    = doc(db,'counters',`memberId-${year}`)

runTransaction:
  READS  (all reads before any write):
    memberSnap  = tx.get(newMemberRef)   → if exists: abort 'ALREADY_CREATED' (double submit / retry)
    counterSnap = tx.get(counterRef)
  COMPUTE:
    nextSeq  = counterSnap.exists ? counterSnap.data().lastSeq + 1 : 1     // US-2.2e
    memberId = `GYM-${year}-${String(nextSeq).padStart(4,'0')}`            // 10000+ grows naturally (US-2.2d)
  WRITES:
    tx.set(counterRef, { year, lastSeq: nextSeq, updatedAt: serverTimestamp(), updatedBy: uid })
    tx.set(newMemberRef, { ...member, memberId, memberIdYear: year, lastAuditId: newAuditRef.id, ... })
    tx.set(newAuditRef, { action:'MEMBER_CREATED', entity:'member', entityId:newMemberRef.id, ... })
    if (medicalNotes) tx.set(doc(db,'memberMedical',newMemberRef.id), {...})
```

- Concurrency: two simultaneous registrations contend on the counter doc; Firestore retries the loser, which re-reads `lastSeq` and gets the next number (AC-7, US-2.2a).
- Rollback: a failed transaction writes nothing, so no ID is consumed (US-2.2b/c).
- Rules additionally require that a member create is accompanied by exactly `lastSeq + 1` on the counter (§3.3), so a client cannot mint IDs without consuming the sequence.
- The photo is **not** in this transaction (US-2.5d): it is written afterwards to `memberPhotos/{memberDocId}`; a failure leaves the member intact and the profile offers a retry.

### 2.4 Medical notes (separate Admin-only document)

```ts
// memberMedical/{memberDocId}
interface MemberMedicalDoc { notes: string; updatedAt: Timestamp; updatedBy: string }
```

Firestore rules cannot hide a single field, so medical data lives in its own document with `allow read, write: if isAdmin()` (compliance requirement; US-2.6b). Consequences enforced by design, not by UI:
- Every members-list query and CSV export reads `members`, which physically cannot contain medical notes (US-2.6c, FR-10).
- Audit metadata records only the fact that medical notes changed, never the content (FR-13).
- The profile page loads the medical section lazily and only for ADMIN; STAFF never renders it and a direct read is denied (rules test).

### 2.5 Photo document

```ts
// memberPhotos/{memberDocId}
interface MemberPhotoDoc {
  dataUrl: string;        // 'data:image/webp;base64,...'  ≤ 180,000 chars (~135 KB binary)
  contentType: 'image/webp' | 'image/jpeg';
  bytes: number;          // decoded size, ≤ 102400
  width: number; height: number;
  updatedAt: Timestamp; updatedBy: string;
}
```

Client pipeline (US-2.5, NEW-23): accept JPEG/PNG/WebP ≤ 5 MB → decode to `ImageBitmap` → draw onto a `<canvas>` capped at 512×512 (cover crop) → `canvas.toBlob('image/webp', q)` with quality stepped down (0.8 → 0.6 → 0.45) until ≤ 100 KB → base64. Re-encoding through canvas **drops all EXIF/GPS metadata** by construction, which satisfies the "no location metadata" requirement without an EXIF library. If the target size cannot be reached, show a friendly error and keep the form usable (US-2.5c). Separate document keeps list reads small (R-8: 1 MiB document limit, read cost); photos are shown on the profile and the check-in screen only, never in list rows (NEW-23).

### 2.6 Audit log (append-only)

```ts
// auditLogs/{auditId}  — create-only, never updated or deleted
interface AuditDoc {
  actorUid: string; actorName: string; actorRole: 'ADMIN' | 'STAFF';
  action: 'MEMBER_CREATED' | 'MEMBER_UPDATED' | 'MEMBER_DELETED'
        | 'MEMBER_SUSPENDED' | 'MEMBER_REACTIVATED'
        | 'MEMBERSHIP_CREATED' | 'MEMBERSHIP_RENEWED'
        | 'PAYMENT_CREATED' | 'PAYMENT_VOIDED'
        | 'PLAN_CREATED' | 'PLAN_UPDATED' | 'PLAN_DELETED'
        | 'REPORT_EXPORTED';                       // NEW-20: exports are logged
  entity: 'member' | 'membership' | 'payment' | 'plan' | 'report';
  entityId: string;
  entityLabel: string;         // e.g. 'GYM-2026-0001 Rahul Sharma' — readable without a join
  at: Timestamp;               // == request.time (rules-enforced)
  metadata: Record<string, string | number | boolean>;  // no sensitive values, no medical content
}
```

`metadata` conventions: `MEMBER_UPDATED` → `{ changedFields: 'firstName,address' }` (names only, FR-13); `MEMBERSHIP_*` → `{ planName, startDate, endDate, amountPaise }`; `PAYMENT_*` → `{ membershipId, amountPaise, method }` (never a reference that could be card-like); `REPORT_EXPORTED` → `{ report, from, to, rowCount }`.

No viewer UI in the MVP (NEW-22); read access is granted to ADMIN so the Firebase console and a future page both work.

### 2.7 Denormalized summaries: exactly which transaction maintains what

| Denormalized field | Lives on | Maintained by (and only by) |
|---|---|---|
| `membership.{membershipId,planId,planName,startDate,endDate,amountPaise}`, `hasMembership` | `members` | **TX-2 assign**, **TX-3 renew** — and only if the new `endDate ≥ current endDate` (a back-dated membership must never pull the member's latest end date backwards, D-5) |
| `pendingPaise` | `members` | **TX-2/TX-3** `+= amountPaise − initialPaymentPaise`; **TX-4 payment** `−= amountPaise`; **TX-5 void** `+= amountPaise`. Never touched by suspend/delete/attendance |
| `paidPaise`, `outstandingPaise`, `unpaid` | `memberships` | **TX-2/TX-3** (initial payment), **TX-4**, **TX-5** |
| `suspended`, `suspendedAt/Reason/By` | `members` | **TX-6 suspend/reactivate** only |
| `deleted`, `deletedAt/By` | `members` | **TX-7 soft delete** only |
| `searchFullName`, `searchReverseName`, `searchMobile`, `displayName` | `members` | **TX-1**, **TX-8 update member** (recomputed from names/mobile in the same write) |
| `memberDisplayName`, `memberId`, `planName`, `planDuration*` snapshots | `memberships`, `payments`, `attendance` | written at create time, never refreshed (deliberate: they are historical snapshots) |
| `checkedOut` | `attendance` | **TX-9 check-out** |
| `lastAuditId` | `members`, `memberships`, `payments` | every audited transaction |

Transaction catalogue (each is one `runTransaction`, all reads before writes, pre-generated document IDs for idempotency):

| # | Name | Reads | Writes | Key invariants |
|---|---|---|---|---|
| TX-1 | `registerMember` | new member ref, `counters/memberId-{YYYY}` | counter, member, audit, (medical) | counter +1 exactly; member absent before |
| TX-2 | `assignMembership` | member, plan, new membership ref | membership, member summary + `pendingPaise`, (payment), audit | plan active; member not deleted; `endDate` from plan duration |
| TX-3 | `renewMembership` | member, plan, new membership ref | same as TX-2 | start = `max(latestEnd + 1 day, today)`; blocked if `suspended` (NEW-7) or `deleted` |
| TX-4 | `recordPayment` | membership, member, new payment ref | payment, membership paid/outstanding/unpaid, member `pendingPaise`, audit | `0 < amount ≤ membership.outstandingPaise`; `paymentDate ≤ today` |
| TX-5 | `voidPayment` | payment, membership, member | payment (`voided=true`), membership, member, audit | payment not already voided; totals restored exactly |
| TX-6 | `setSuspended` | member | member, audit | dates untouched (resolved Q3) |
| TX-7 | `softDeleteMember` | member | member, audit | never a hard delete |
| TX-8 | `updateMember` | member | member, (medical), audit | `updatedAt` matches the value the form loaded → otherwise `CONFLICT` (US-2.10d); `memberId`/`createdAt`/summary/`pendingPaise` unchanged |
| TX-9 | `checkIn` / `checkOut` / `markAbsent` | attendance doc (deterministic id) | attendance | one per member per IST day; check-out after check-in, same day (NEW-13) |
| TX-10 | plan create/update/delete | plan | plan, audit | delete only after a `count()==0` pre-check (§3.3) |

Drift containment (R-2): `pendingPaise` and `paidPaise` are reconstructable from `payments` + `memberships`. Phase 8 ships a read-only **reconciliation script** (`scripts/reconcile.ts`, run manually against a project) that recomputes both and reports mismatches. It is a diagnostic, not a scheduled job.

### 2.8 Dashboard counters

**Decision: no counter documents in the MVP.** Firestore aggregation queries (`getCountFromServer`, `getAggregateFromServer` with `sum()`) give exact, drift-free values for every card and chart at a read cost that is bounded by index entries scanned, not by collection size. For a single gym this is comfortably cheaper than the correctness risk of another denormalized surface (R-2). See §5.4 for the read budget and §5.5 for the counter design kept in reserve, plus the trigger for adopting it.

---

## 3. Security model

### 3.1 Role bootstrap

1. In the Firebase console → Authentication → Users → add the owner's email/password.
2. Copy the generated UID.
3. Firestore console → create `users/{uid}` = `{ email, displayName, role: 'ADMIN', active: true, createdAt }`.
4. `users` is **never writable from the app** (`allow write: if false`). Staff/Member accounts are created the same way (NEW-17); there is no user-management UI in the MVP.
5. README documents this as the "first admin bootstrap" and warns that deleting the `users` doc locks the owner out of the app (not out of the console).

Because the app never writes `users`, AC-12 (role forgery) is satisfied structurally rather than by a validation rule.

### 3.2 Rules helpers

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function userDoc()   { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data; }
    function signedIn()  { return request.auth != null; }
    function hasRole()   { return signedIn() && exists(/databases/$(database)/documents/users/$(request.auth.uid)) && userDoc().active == true; }
    function role()      { return userDoc().role; }
    function isAdmin()   { return hasRole() && role() == 'ADMIN'; }
    function isStaff()   { return hasRole() && role() == 'STAFF'; }
    function isMember()  { return hasRole() && role() == 'MEMBER'; }
    function staffOrAdmin() { return isAdmin() || isStaff(); }
    function myMemberDocId() { return userDoc().memberDocId; }      // future MEMBER role

    function changed(keys) { return request.resource.data.diff(resource.data).affectedKeys().hasOnly(keys); }
    function unchanged(f)  { return request.resource.data[f] == resource.data[f]; }
    function serverTime(f) { return request.resource.data[f] == request.time; }
    function actorIs(f)    { return request.resource.data[f] == request.auth.uid; }
    function money(v)      { return v is int && v >= 0; }
```

Cost note (NFR-9): each rule evaluation that calls `userDoc()` performs a billed document read. Identical `get()` paths inside one evaluation are resolved once, so the helper chain above costs one read per evaluated request — but *verify the current document-access limits* (documented as 10 access calls for single-document/query requests and 20 for transactions and batched writes; confirm against current Firebase docs before relying on the `getAfter()` checks in §3.3). Emulator tests assert we stay under the limit for the heaviest commit (TX-4).

### 3.3 Per-collection rules (mapped to the Permission Matrix)

```
    // users — role source of truth. No client writes, ever.  (matrix rows 1-2, AC-12)
    match /users/{uid} {
      allow get:  if signedIn() && (request.auth.uid == uid || isAdmin());
      allow list: if isAdmin();
      allow write: if false;
    }

    // members  (matrix rows 3-8)
    match /members/{memberDocId} {
      allow get, list: if staffOrAdmin()
                       || (isMember() && memberDocId == myMemberDocId());   // future
      allow create: if staffOrAdmin()
        && request.resource.data.memberId.matches('^GYM-[0-9]{4}-[0-9]{4,}$')
        && request.resource.data.deleted == false
        && request.resource.data.suspended == false
        && request.resource.data.pendingPaise == 0
        && request.resource.data.hasMembership == false
        && serverTime('createdAt') && actorIs('createdBy')
        && request.resource.data.consent.given == true
        // the ID must consume exactly one counter increment in this same commit
        && getAfter(/databases/$(database)/documents/counters/$('memberId-' + string(request.resource.data.memberIdYear))).data.lastSeq
           == get(/databases/$(database)/documents/counters/$('memberId-' + string(request.resource.data.memberIdYear))).data.lastSeq + 1;
      allow update: if isAdmin()
        && unchanged('memberId') && unchanged('memberIdYear')
        && unchanged('createdAt') && unchanged('createdBy')
        && serverTime('updatedAt') && actorIs('updatedBy')
        && request.resource.data.pendingPaise is int && request.resource.data.pendingPaise >= 0;
      allow delete: if false;                                  // soft-delete only (Q6)
    }

    // medical notes — Admin only, physically separated (compliance)
    match /memberMedical/{memberDocId} {
      allow read, write: if isAdmin();
    }

    // photos — Staff may add at registration (create) but not replace (update)
    match /memberPhotos/{memberDocId} {
      allow read:   if staffOrAdmin() || (isMember() && memberDocId == myMemberDocId());
      allow create: if staffOrAdmin() && request.resource.data.bytes <= 102400
                    && request.resource.data.dataUrl.size() <= 180000;
      allow update: if isAdmin() && request.resource.data.bytes <= 102400
                    && request.resource.data.dataUrl.size() <= 180000;
      allow delete: if isAdmin();
    }

    // plans
    match /membershipPlans/{planId} {
      allow read:  if hasRole();
      allow create, update: if isAdmin()
        && request.resource.data.pricePaise is int && request.resource.data.pricePaise > 0
        && request.resource.data.durationValue is int && request.resource.data.durationValue > 0
        && request.resource.data.durationUnit in ['DAYS','MONTHS'];
      allow delete: if isAdmin();          // safe-delete pre-check is client-side, see note below
    }

    // memberships — period and amount immutable after create (members can never change expiry)
    match /memberships/{membershipId} {
      allow get, list: if staffOrAdmin()
                       || (isMember() && resource.data.memberDocId == myMemberDocId());
      allow create: if isAdmin()
        && request.resource.data.endDate > request.resource.data.startDate
        && money(request.resource.data.amountPaise)
        && request.resource.data.paidPaise >= 0
        && request.resource.data.outstandingPaise == request.resource.data.amountPaise - request.resource.data.paidPaise
        && request.resource.data.unpaid == (request.resource.data.outstandingPaise > 0)
        && serverTime('createdAt') && actorIs('createdBy');
      allow update: if isAdmin()
        && changed(['paidPaise','outstandingPaise','unpaid','updatedAt','updatedBy','lastAuditId'])
        && request.resource.data.outstandingPaise == resource.data.amountPaise - request.resource.data.paidPaise
        && request.resource.data.outstandingPaise >= 0
        && request.resource.data.unpaid == (request.resource.data.outstandingPaise > 0)
        && serverTime('updatedAt') && actorIs('updatedBy');
      allow delete: if false;
    }

    // payments — Admin-only, immutable, one-way void  (matrix rows: record/void payment)
    match /payments/{paymentId} {
      allow get, list: if isAdmin()
                       || (isMember() && resource.data.memberDocId == myMemberDocId());
      allow create: if isAdmin()
        && request.resource.data.amountPaise is int && request.resource.data.amountPaise > 0
        && request.resource.data.method in ['CASH','UPI','CARD','BANK_TRANSFER','OTHER']
        && request.resource.data.voided == false
        && request.resource.data.paymentDate <= request.time
        && serverTime('createdAt') && actorIs('createdBy')
        // the membership's paid total must rise by exactly this amount in the same commit
        && getAfter(/databases/$(database)/documents/memberships/$(request.resource.data.membershipId)).data.paidPaise
           == get(/databases/$(database)/documents/memberships/$(request.resource.data.membershipId)).data.paidPaise
              + request.resource.data.amountPaise;
      allow update: if isAdmin()
        && resource.data.voided == false && request.resource.data.voided == true
        && changed(['voided','voidReason','voidedAt','voidedBy','lastAuditId'])
        && request.resource.data.voidedAt == request.time
        && request.resource.data.voidedBy == request.auth.uid;
      allow delete: if false;
    }

    // attendance — Staff may mark; only Admin may edit/backdate/delete (matrix)
    match /attendance/{attendanceId} {
      allow get, list: if staffOrAdmin()
                       || (isMember() && resource.data.memberDocId == myMemberDocId());
      allow create: if staffOrAdmin()
        && attendanceId == request.resource.data.memberDocId + '_' + request.resource.data.dateKey
        && request.resource.data.status in ['PRESENT','ABSENT']
        && serverTime('createdAt') && actorIs('createdBy');
      allow update: if staffOrAdmin()
        && unchanged('memberDocId') && unchanged('dateKey') && unchanged('date')
        && serverTime('updatedAt') && actorIs('updatedBy');
      allow delete: if isAdmin();
    }

    match /trainers/{trainerId} {
      allow read:  if hasRole();
      allow write: if isAdmin();
    }

    // member-ID counter — monotone by exactly 1, never resettable
    match /counters/{counterId} {
      allow read:   if staffOrAdmin();
      allow create: if staffOrAdmin() && request.resource.data.lastSeq == 1;
      allow update: if staffOrAdmin()
                    && request.resource.data.lastSeq == resource.data.lastSeq + 1
                    && unchanged('year');
      allow delete: if false;
    }

    // audit — append only
    match /auditLogs/{auditId} {
      allow read:   if isAdmin();                       // NEW-22: no UI yet, console/future page
      allow create: if staffOrAdmin()
        && request.resource.data.actorUid == request.auth.uid
        && request.resource.data.at == request.time
        && request.resource.data.entity in ['member','membership','payment','plan','report'];
      allow update, delete: if false;
    }

    match /notifications/{id} { allow read: if isAdmin(); allow write: if false; }  // Phase 7 stub
    match /settings/{docId}   { allow read: if hasRole(); allow write: if isAdmin(); }

    match /{document=**} { allow read, write: if false; }    // deny by default (US-1.9d)
  }
}
```

How the high-risk rows are covered:

| Requirement | Mechanism |
|---|---|
| Role never from the client | `users` is `allow write: if false`; role read with `get()` inside rules |
| Members cannot edit expiry | MEMBER has no write rule on `memberships` at all; `startDate/endDate/amountPaise` are immutable even for ADMIN after create |
| Payments immutable | `payments` update limited to the one-way void field set; delete `false` |
| Overpayment | TX-4 checks `amount ≤ outstanding` inside the transaction **and** rules verify the membership's `paidPaise` rises by exactly the payment amount and `outstandingPaise ≥ 0` |
| Duplicate/forged member IDs | format regex + the counter must increment by exactly 1 in the same commit; counter itself is monotone |
| Audit cannot be skipped (partially) | `lastAuditId` + `getAfter()` hardening (Phase 8, §3.4) |
| Staff sees no medical data / money | `memberMedical` and `payments` reads are `isAdmin()` |
| Unauthenticated | deny-by-default catch-all + every rule requires `hasRole()` |
| Missing/unknown `users` doc | `hasRole()` requires `exists()` and `active == true`; unknown role values match no branch ⇒ denied |

**Plan safe-delete (US-3.3c).** Rules cannot query, so "no membership references this plan" cannot be enforced server-side. Design: (a) the client runs `getCountFromServer(query(memberships, where('planId','==',id)))` and refuses when > 0, including memberships of soft-deleted members; (b) the residual race (a membership created during the delete) is **benign by construction** because memberships snapshot `planName`, `planDurationValue/Unit` and `amountPaise`, so a dangling `planId` never breaks display, history or reports. The UI steers the owner towards Deactivate.

### 3.4 Audit-atomicity hardening (Phase 8, optional)

Add to the `members`/`memberships`/`payments` create+update rules:

```
&& getAfter(/databases/$(database)/documents/auditLogs/$(request.resource.data.lastAuditId)).data.entityId == <docId>
```

This makes it impossible to write one of those documents without an audit record in the same commit, closing most of R-1. It is scheduled for Phase 8 rather than Phase 2 because it consumes extra document-access calls per commit; the Phase 8 rules tests must confirm the heaviest transaction (TX-4: payment + membership + member + audit) stays within the per-commit access-call limit. If it does not, drop the check from `members.update` first (lowest value), then from `memberships`.

### 3.5 Rules emulator test plan

`tests/rules/` run against the Firestore emulator with `@firebase/rules-unit-testing`, one file per collection, executed by `npm run test:rules` (and in Phase 8, by CI). Each test seeds data with `withSecurityRulesDisabled`.

Fixtures: `admin` (`users/admin` ADMIN), `staff`, `member1` (MEMBER linked to `mem1`), `member2`, `noRole` (authenticated, no `users` doc), `inactive` (`active:false`), `anon`.

| File | Cases (allow / deny) |
|---|---|
| `baseline.test.ts` | anon denied on every collection path (AC-10); unlisted path `/foo/bar` denied; `noRole` and `inactive` denied everywhere except their own `users` doc |
| `users.test.ts` | own doc read allowed; other user's doc denied for staff/member; admin reads any; **any** write denied incl. `{role:'ADMIN'}` create and update (AC-12) |
| `members.test.ts` | admin create/update allowed; staff create allowed, update denied; member reads own only, other denied; write denied; create with `deleted:true`/`pendingPaise:5`/bad `memberId` format denied; create without the counter increment denied; `memberId` change denied; hard delete denied |
| `counters.test.ts` | `lastSeq+1` allowed; `+2`, decrement, arbitrary value, year change, delete denied |
| `medical.test.ts` | admin read/write allowed; staff read denied, write denied; member denied (US-2.6b) |
| `photos.test.ts` | staff create allowed, staff update denied, >100 KB denied, oversized `dataUrl` denied; member reads own only |
| `plans.test.ts` | staff read allowed, staff write denied; price ≤ 0 denied; bad `durationUnit` denied |
| `memberships.test.ts` | admin create allowed; `endDate ≤ startDate` denied; wrong `outstandingPaise` denied; any change to `startDate/endDate/amountPaise/planId` denied; staff create denied; member write denied (AC-11) |
| `payments.test.ts` | admin create allowed when the membership update matches; create **without** the membership update denied; amount larger than the membership increment denied; future `paymentDate` denied; staff create denied; member create denied; update of `amountPaise` denied; void flip allowed once, un-void denied; delete denied |
| `attendance.test.ts` | staff create/update allowed; mismatched doc id denied; staff delete denied, admin delete allowed; member reads own only |
| `audit.test.ts` | staff/admin create allowed; `actorUid` spoof denied; `at` not equal to `request.time` denied; update and delete denied (US-2.14c); staff read denied, admin read allowed |
| `budget.test.ts` | the TX-4 commit and the heaviest list query succeed (proves the document-access-call limit is not exceeded) |

Rules tests are written in the phase that introduces the collection and all of them must pass in Phase 8 (US-8.2a: one passing test per Permission-Matrix row).

---

## 4. Authentication strategy

### 4.1 Flow

```
App boot
  └ validate VITE_* env  → missing ⇒ ConfigErrorPage naming the key (US-1.8b)
  └ initializeApp / getAuth / getFirestore  (browserLocalPersistence, the SDK default)
  └ AuthProvider subscribes to onAuthStateChanged
        state: 'initialising' ─────────────► FullPageLoader (never flash the login page, US-1.2a)
               'signedOut'    ─────────────► /login
               'roleLoading'  ─────────────► FullPageLoader
               'roleError'    ─────────────► retryable error screen, no protected UI (US-1.6c)
               'noAccess'     ─────────────► "You do not have access to this application" + signOut (US-1.6b)
               'ready'        ─────────────► { user: {uid,email,displayName}, role }
```

- On `onAuthStateChanged(user)`, `userService.getUserDoc(uid)` reads `users/{uid}` **once** and caches it in context for the session. Missing doc, `active === false`, an unrecognised role, or a role with no UI in the current phase ⇒ `noAccess` ⇒ `signOut()` with a clear message (FR-1, US-1.6b). Phase 1 admits ADMIN only; the allowed set is a constant per phase so adding STAFF later is a one-line change.
- A permission-denied error on the `users` read is treated as `noAccess`; a network error is `roleError` with retry (distinct handling, US-1.6c).
- Sign-out in another tab: `onAuthStateChanged` fires in every tab ⇒ redirect to `/login` (US-1.2c).
- Session policy: Firebase default persistent session, no idle timeout (NEW-18).

### 4.2 Login, forgot password

- `LoginPage`: React Hook Form + Zod (email format, non-empty password) ⇒ no network call on invalid input (US-1.1c). Submit disabled while in flight (US-1.1f). All Firebase auth errors map through `mapAuthError()` to: invalid credentials (single generic message for wrong password *and* unknown email, US-1.1b), too many attempts, network/unavailable, and a fallback. Raw codes never surface (NFR-4).
- `ForgotPasswordPage`: `sendPasswordResetEmail` always renders the same generic confirmation regardless of outcome (US-1.4a), except for network failures which offer retry. Firebase's hosted reset page is used as-is.
- No sign-up screen exists anywhere in the app (NEW-17).

### 4.3 Guards

```tsx
<RequireAuth>            // redirects to /login?next=<path>, restores after login (US-1.5b)
  <RequireRole allow={['ADMIN']}>   // 403 screen when the role is not allowed (US-1.6d)
    <AppLayout/>        // shell with <Outlet/>
```

`RequireRole` is a pure, unit-testable component: given `role` and `allow`, render or deny. Route definitions carry `allow` so the sidebar and the guard read the same constant (`constants/navigation.ts`), and hidden menu items are also blocked by the guard — with rules as the real enforcement (UI hiding is not security).

### 4.4 Render authorized domain

Firebase Console → Authentication → Settings → **Authorized domains**: add `hercules-fitness.onrender.com` (the actual Render subdomain) plus any custom domain. `localhost` is present by default. Without this, sign-in and password-reset links fail on the deployed site. This is a manual, documented step in the README production checklist (NFR-8, US-8.6a).

---

## 5. Query, index and pagination strategy

### 5.1 Status as a date range (single source of truth)

`domain/status.ts` exports one function used by the list filter, the dashboard cards, the Expiring/Expired pages and the reports, so the numbers can never disagree (FR-4, US-3.4g):

```ts
type StatusFilter = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'SUSPENDED' | 'NO_MEMBERSHIP';

// today = IST day start as a Timestamp
function statusConstraints(s: StatusFilter, today: Timestamp): QueryConstraint[] {
  ACTIVE        → [deleted==false, suspended==false, endDate >= today+8d]
  EXPIRING_SOON → [deleted==false, suspended==false, endDate >= today, endDate <= today+7d]
  EXPIRED       → [deleted==false, suspended==false, endDate <  today]
  SUSPENDED     → [deleted==false, suspended==true]
  NO_MEMBERSHIP → [deleted==false, hasMembership==false]
}
```

Because `endDate` is stored at IST midnight, `<=` and `>=` are exact day comparisons; the partition rule (Total = Active + Expiring + Expired + Suspended + No membership) holds exactly, since the four date buckets are disjoint and `suspended`/`hasMembership` are mutually exclusive with them by the `suspended==false` / non-null-endDate predicates.

The Expiring page's 1/3/7/15-day window is the same shape with `today+Nd` (US-3.9), and an explicit expiry-date-range filter is also the same shape — so **status filter and expiry range are the same query**; when both are set, the app intersects the two ranges and shows an empty state if the intersection is empty.

### 5.2 Search: normalized fields and prefix queries

Firestore has no full-text search. Members carry three lowercase normalized fields:

| Field | Value for "Rahul Sharma", 9876543210 | Matches |
|---|---|---|
| `searchFullName` | `rahul sharma` | first-name prefix, "first last" prefix |
| `searchReverseName` | `sharma rahul` | last-name prefix, "last first" prefix |
| `searchMobile` | `9876543210` | mobile prefix |
| `memberId` | `GYM-2026-0001` | member-ID prefix (uppercased input) |

Prefix query: `where(f, '>=', term), where(f, '<=', term + ''), orderBy(f)`.

Field inference from the input (stated in the UI hint): all digits ⇒ mobile; starts with `gym` (case-insensitive) ⇒ member ID; otherwise name (runs the `searchFullName` and `searchReverseName` queries and **merges**: fetch `pageSize` from each, dedupe by doc id, sort by `searchFullName`, take `pageSize`, keep a cursor per sub-query so "next page" advances only the consumed source). This covers US-2.8b/c with two queries instead of three name fields.

Search is **prefix-only and case-insensitive**; "ahul" does not match "Rahul" — stated in the placeholder text. Names are normalized with `trim().toLowerCase().normalize('NFKD')` and internal whitespace collapsed.

### 5.3 Supported combinations on the members list (and what is disabled)

| # | Search | Status / expiry range | Plan | Sort | Supported |
|---|---|---|---|---|---|
| 1 | – | – | – | Registered (createdAt) desc — **default** (NEW-25) | yes |
| 2 | – | – | ✓ | createdAt desc | yes |
| 3 | – | ✓ (any of the 3 date buckets or a range) | – | endDate asc / desc | yes |
| 4 | – | ✓ | ✓ | endDate asc / desc | yes |
| 5 | – | SUSPENDED | ✓/– | createdAt desc | yes |
| 6 | – | NO_MEMBERSHIP | – | createdAt desc | yes |
| 7 | ✓ | – | – | by the searched field | yes |
| 8 | ✓ | ✓ | any | any | **no — disabled** |
| 9 | – | ✓ | – | createdAt | **no — sort is forced to endDate when a date filter is active** |

Rule 8 exists because a prefix range and an expiry range on different fields force the result order to start with the search field, which makes "sorted by expiry" untrue and makes pagination cursors ambiguous. UI behaviour (US-3.8e): when a search term is typed, the status/expiry/sort controls become disabled with the tooltip "Filters are unavailable while searching — clear the search to filter"; the filters are **never** applied client-side to the current page only. Rule 9: selecting a status or date range switches the sort control to expiry asc/desc.

Suspended members never appear under Active/Expiring/Expired (their predicates carry `suspended==false`) but **do** appear in unfiltered browsing and in search, flagged with a SUSPENDED badge (US-3.8f).

### 5.4 Pagination and read budget

- Cursor pagination (`orderBy(...)`, `limit(pageSize + 1)`, `startAfter(lastDoc)`); page size 25 (NEW-25). The extra document tells the UI whether a next page exists without a count. Previous-page navigation keeps a stack of page-first cursors (no `endBefore` round-trips). Offset paging (`.offset()`) is never used — it bills skipped documents.
- A result count is shown only where it is cheap and useful: one `getCountFromServer` per filter change (1 billed read for the count, per the aggregation billing model), not per page.
- Stale-response protection (US-2.8e): each query carries a monotonically increasing request token; responses with an older token are discarded. Search input is debounced 300 ms.
- `SUM`/`COUNT` aggregations are billed by index entries scanned rather than documents returned — confirm the exact current billing and limits in the Firebase documentation before quoting numbers to the owner (do not assume).

**Dashboard load budget (FR-9, US-3.12c):** no unbounded reads, ever.

| Element | Query | Reads |
|---|---|---|
| Total / Active / Expiring / Expired / Suspended / No-membership cards | 6 × `getCountFromServer` on `members` | 6 aggregations |
| Pending Payments (amount + member count) | `sum(pendingPaise)` + `count()` where `deleted==false, pendingPaise>0` | 2 aggregations |
| Current-month revenue | `sum(amountPaise)` on `payments` where `voided==false`, `paymentDate` in the IST month | 1 aggregation |
| Today's attendance / currently checked-in | 2 × `count()` on `attendance` | 2 aggregations |
| New members / revenue / attendance by month | 12 × 3 aggregations (one per IST month) | 36 aggregations |
| Plan distribution | 1 aggregation per active plan (≈ 4-6) | ~5 aggregations |
| "Expiring Soon" table | `limit(10)` document query | 10 document reads |

≈ 52 aggregation queries + 10 document reads + one rules `get(users)` per query. Well inside any plausible free-tier daily budget for a single gym, and it never grows with member count. Results are cached in memory for the session with an explicit **Refresh** control that also recomputes "today" (US-3.12e). The 36 chart aggregations are issued in parallel but only when the charts scroll into view (Phase 3+).

### 5.5 Counter documents (designed, not built)

Kept in reserve in case the aggregation read volume becomes a problem (e.g. many concurrent staff devices refreshing the dashboard):

```ts
// metrics/monthly_{YYYY-MM}  (IST months)
interface MonthlyMetricsDoc {
  newMembers: number; revenuePaise: number; attendancePresent: number; updatedAt: Timestamp;
}
// metrics/live  { totalMembers, activeMembers, ... }
```

They would be updated with `increment()` inside TX-1 / TX-4 / TX-5 / TX-9. Not adopted for the MVP because they add a fourth denormalized surface (R-2) and because per-status live counters cannot be maintained without daily writes — the exact thing FR-4 forbids. **Adoption trigger:** if the measured dashboard read cost in Phase 8 (US-8.3a) exceeds the agreed budget, adopt monthly metrics for the three charts only (−36 aggregations per load) and keep the cards on live aggregation.

### 5.6 `firestore.indexes.json`

```json
{
  "indexes": [
    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "suspended", "order": "ASCENDING" },
      { "fieldPath": "membership.endDate", "order": "ASCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "suspended", "order": "ASCENDING" },
      { "fieldPath": "membership.endDate", "order": "DESCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "suspended", "order": "ASCENDING" },
      { "fieldPath": "membership.planId", "order": "ASCENDING" },
      { "fieldPath": "membership.endDate", "order": "ASCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "suspended", "order": "ASCENDING" },
      { "fieldPath": "membership.planId", "order": "ASCENDING" },
      { "fieldPath": "membership.endDate", "order": "DESCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "suspended", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "membership.planId", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "hasMembership", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "searchFullName", "order": "ASCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "searchReverseName", "order": "ASCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "searchMobile", "order": "ASCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "memberId", "order": "ASCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "pendingPaise", "order": "DESCENDING" } ] },

    { "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "deleted", "order": "ASCENDING" },
      { "fieldPath": "joiningDate", "order": "ASCENDING" } ] },

    { "collectionGroup": "memberships", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "memberDocId", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" } ] },

    { "collectionGroup": "memberships", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "memberDocId", "order": "ASCENDING" },
      { "fieldPath": "endDate", "order": "DESCENDING" } ] },

    { "collectionGroup": "memberships", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "memberDocId", "order": "ASCENDING" },
      { "fieldPath": "unpaid", "order": "ASCENDING" },
      { "fieldPath": "startDate", "order": "ASCENDING" } ] },

    { "collectionGroup": "memberships", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "planId", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" } ] },

    { "collectionGroup": "memberships", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "unpaid", "order": "ASCENDING" },
      { "fieldPath": "startDate", "order": "ASCENDING" } ] },

    { "collectionGroup": "payments", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "voided", "order": "ASCENDING" },
      { "fieldPath": "paymentDate", "order": "ASCENDING" } ] },

    { "collectionGroup": "payments", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "voided", "order": "ASCENDING" },
      { "fieldPath": "paymentDate", "order": "DESCENDING" } ] },

    { "collectionGroup": "payments", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "voided", "order": "ASCENDING" },
      { "fieldPath": "method", "order": "ASCENDING" },
      { "fieldPath": "paymentDate", "order": "DESCENDING" } ] },

    { "collectionGroup": "payments", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "memberDocId", "order": "ASCENDING" },
      { "fieldPath": "voided", "order": "ASCENDING" },
      { "fieldPath": "paymentDate", "order": "DESCENDING" } ] },

    { "collectionGroup": "payments", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "membershipId", "order": "ASCENDING" },
      { "fieldPath": "paymentDate", "order": "DESCENDING" } ] },

    { "collectionGroup": "attendance", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "date", "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "checkInAt", "order": "DESCENDING" } ] },

    { "collectionGroup": "attendance", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "date", "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "checkedOut", "order": "ASCENDING" } ] },

    { "collectionGroup": "attendance", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "memberDocId", "order": "ASCENDING" },
      { "fieldPath": "date", "order": "DESCENDING" } ] },

    { "collectionGroup": "attendance", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "date", "order": "ASCENDING" } ] },

    { "collectionGroup": "auditLogs", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "entity", "order": "ASCENDING" },
      { "fieldPath": "entityId", "order": "ASCENDING" },
      { "fieldPath": "at", "order": "DESCENDING" } ] },

    { "collectionGroup": "auditLogs", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "actorUid", "order": "ASCENDING" },
      { "fieldPath": "at", "order": "DESCENDING" } ] }
  ],
  "fieldOverrides": []
}
```

Indexes are added incrementally per phase (Phase 2 needs the `members` ones, Phase 3 the membership/expiry ones, etc.) and deployed with `firebase deploy --only firestore:indexes`. Every new query added by a developer must arrive with its index entry in the same commit (US-8.3b).

### 5.7 Reports

Every report is a paginated query over an indexed field (§5.6) plus streamed CSV generation: `joiningDate` range (member report), `membership.endDate` range (expiring/expired — identical predicates to the pages, US-6.1e), `paymentDate` range + `voided==false` (revenue), attendance `date` range + `status`, and pending payments.

**Pending-payment report deviation:** NEW-20's default filters pending by *membership start date*. Doing that from `memberships` would include soft-deleted members' memberships unless a `memberDeleted` flag were denormalized onto every membership — a fan-out write on soft-delete. The design instead runs the pending report over `members` (`deleted==false, pendingPaise>0`, ordered by `pendingPaise` desc) with an optional **joining-date** range filter, and links each row to the member's unpaid memberships. Flagged in §11 for confirmation.

CSV is built client-side in pages: fetch page → append rows → progress indicator → cap at a configured maximum (default 5,000 rows) with a warning above it (US-6.2d). UTF-8 BOM prefix; `DD/MM/YYYY` dates; amounts as plain rupee numbers with 2 decimals; any cell starting with `= + - @` (or tab/CR) is prefixed with `'` (US-6.2b); medical notes are structurally absent. Exports write a `REPORT_EXPORTED` audit record (NEW-20).

---

## 6. Date, status and money utilities

### 6.1 Library choice: Luxon

**Decision: `luxon`** (+ `@types/luxon`). Rationale: first-class IANA zone support (`DateTime.fromJSDate(d, { zone: 'Asia/Kolkata' })`), `startOf('day')`, `plus({ months })` with correct month-end clamping, and readable code in the one place the project cannot afford subtle bugs. Alternative considered: `date-fns` + `date-fns-tz` — smaller and tree-shakeable, but zone handling is bolt-on and the `utcToZonedTime`/`zonedTimeToUtc` round-trips are exactly where timezone bugs are introduced. `dayjs` + timezone plugin has the same objection. Tradeoff accepted: Luxon is a single non-tree-shakeable dependency (tens of KB gzipped) — acceptable for a desktop-first admin tool, and it is the only date dependency in the project.

Month clamping verification against the required table (FR-5): 31/01/2026 +1 month → Luxon clamps to 28/02/2026, −1 day ⇒ **27/02/2026** ✓; 29/02/2028 +12 months → 28/02/2029, −1 day ⇒ **27/02/2029** ✓; 01/10 +1m −1d ⇒ 31/10 ✓; 15/01 +1m −1d ⇒ 14/02 ✓; 15/09/2026 +12m −1d ⇒ 14/09/2027 ✓.

### 6.2 `domain/dates.ts`

```ts
const IST = 'Asia/Kolkata';

nowIst(clock?: Clock): DateTime                    // clock injectable for tests
todayIstStart(clock?): DateTime                    // 00:00 IST today
istDayStartTs(d: Date | Timestamp | DateTime): Timestamp   // → IST day start as Timestamp
tsToIstDate(ts: Timestamp): DateTime               // for display/compare
fromCivilDate(y, m, d): Timestamp                  // date-picker input → IST midnight Timestamp
formatIstDate(ts): string                          // 'DD/MM/YYYY'
formatIstDateTime(ts): string                      // 'DD/MM/YYYY HH:mm'
istDayKey(ts): string                              // 'YYYYMMDD' (attendance doc id)
istYear(clock?): number                            // member ID year (US-2.2c)
diffIstDays(from: Timestamp, to: Timestamp): number  // integer IST calendar-day difference
addIstDays(ts, n): Timestamp
istMonthRange(year, month): { start: Timestamp; endExclusive: Timestamp }
```

**Date-picker rule (mandatory, prevents the classic bug):** MUI date pickers hand back a browser-local `Date`. Services must never store it directly; forms convert via `fromCivilDate(d.getFullYear(), d.getMonth()+1, d.getDate())` so only the calendar Y/M/D the user saw is used, re-anchored to IST midnight. A single Zod transform (`zIstDate`) does this so it cannot be forgotten.

### 6.3 `domain/status.ts`

```ts
type MembershipStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'SUSPENDED' | 'NO_MEMBERSHIP';

interface StatusResult { status: MembershipStatus; daysRemaining: number | null; startsInFuture: boolean }

function calculateMembershipStatus(
  startDate: Timestamp | null,
  endDate: Timestamp | null,
  opts?: { suspended?: boolean; clock?: Clock }
): StatusResult
```

Order of evaluation exactly as D-4: no end date ⇒ `NO_MEMBERSHIP`; `endDate < startDate` ⇒ **throws** `InvalidPeriodError` (US-3.4e, never silently computed); `daysRemaining = diffIstDays(todayIstStart, endDate)`; `suspended` ⇒ `SUSPENDED` (with `daysRemaining` still returned, US-3.4b); `< 0` ⇒ EXPIRED; `0..7` ⇒ EXPIRING_SOON; `≥ 8` ⇒ ACTIVE. `startsInFuture` drives the "Starts DD/MM/YYYY" label (NEW-5); it never changes the status.

`clock` injection makes the whole boundary matrix (23:59:59 IST, 00:00:00 IST, device in UTC / America/Los_Angeles) testable without faking the system clock (US-3.4c/d).

### 6.4 `domain/renewal.ts`

```ts
computeEndDate(start: Timestamp, durationValue: number, unit: 'DAYS'|'MONTHS'): Timestamp
  // MONTHS: start.plus({months:N}).minus({days:1});  DAYS: start.plus({days:N-1})  (resolved Q2)

computeRenewalStart(latestEndDate: Timestamp | null, today: Timestamp): Timestamp
  // null            → today                       (first membership)
  // latestEnd >= today → latestEnd + 1 day        (FR-5, AC-5; stacks for repeated early renewals)
  // latestEnd <  today → today                    (AC-6; gap days are not backfilled)
```

Both are pure and called **inside** TX-2/TX-3 with the freshly read `members.membership.endDate`, never with values captured when the dialog opened (US-3.6f, US-3.7a).

### 6.5 `domain/money.ts`

`toPaise(rupeeInput: string|number): Paise` (rejects > 2 decimals, negatives, NaN), `fromPaise(p): number`, `formatInr(p): string` (`₹1,500.00`, `Intl.NumberFormat('en-IN')`), `addPaise/subPaise` with overflow guards. All storage, arithmetic and rules comparisons use integer paise; `0.1 + 0.2` is `10 + 20 = 30` paise = ₹0.30 exactly (D-6, US-4.3d).

### 6.6 Client-clock mitigation (R-3)

Rules already bound writes with `request.time`. For reads/display, after any successful write that used `serverTimestamp()` the service compares the server-resolved value with `Date.now()`; skew above 5 minutes raises a persistent warning banner ("This device's clock is wrong by about N minutes — dates and statuses may be incorrect"). Zero extra reads. Implemented in Phase 8 (hardening), specified here so the write helpers return the resolved timestamp from the start.

---

## 7. Screens, routes and navigation

Sidebar (FR-17): Dashboard · Members · Membership Plans · Payments · Attendance · Trainers · Reports · Settings. Top bar: user name + role chip, Logout. Below the MUI `md` breakpoint the sidebar becomes a temporary drawer.

| Route | Screen | Roles | Phase | Notes |
|---|---|---|---|---|
| `/login` | Login | public | 1 | redirects to `next` after success |
| `/forgot-password` | Forgot password | public | 1 | generic confirmation |
| `/` | → `/dashboard` | auth | 1 | |
| `/dashboard` | Dashboard | ADMIN (STAFF: non-financial subset, P3+) | 1 shell / 2-5 content | refresh control |
| `/members` | Members list | ADMIN, STAFF | 2 | search, filters (P3), pagination |
| `/members/new` | Register member | ADMIN, STAFF (no payment/medical sections) | 2 | plan/payment sections added P3/P4 |
| `/members/expiring` | Expiring soon | ADMIN, STAFF | 3 | window 1/3/7/15, default 7 |
| `/members/expired` | Expired | ADMIN, STAFF | 3 | most recently expired first |
| `/members/:memberDocId` | Member profile | ADMIN, STAFF (no medical) / MEMBER own (future) | 2 | badge + sections |
| `/members/:memberDocId/edit` | Edit member | ADMIN | 2 | optimistic-concurrency guard |
| `/plans` | Membership plans | view: ADMIN, STAFF · edit: ADMIN | 3 | |
| `/payments` | Payments list | ADMIN | 4 | date/method filters |
| `/payments/pending` | Pending payments | ADMIN (STAFF read-only amount on the member list) | 4 | |
| `/attendance` | Today's attendance + check-in/out | ADMIN, STAFF | 5 | |
| `/attendance/monthly` | Monthly attendance report | ADMIN, STAFF | 5 | |
| `/trainers` | Trainers | manage: ADMIN · read: STAFF | 2 | NEW-2 |
| `/reports` | Reports + CSV | ADMIN | 6 | six report tabs |
| `/settings` | Settings | ADMIN | 1 placeholder / 8 | placeholder in the MVP |
| `*` | 404 | any | 1 | inside the shell when signed in |
| — | Access denied | any | 1 | shown by `RequireRole` |
| — | Config error | any | 1 | missing env var, pre-auth |

Static segments (`/members/new`, `/members/expiring`, `/members/expired`) rank above `/members/:memberDocId` in React Router v6, and auto-generated document IDs never collide with those words.

Dialog-level screens (not routes, so a refresh never lands on a half-filled dialog): Assign plan, Renew, Record payment, Void payment, Suspend/Reactivate, Delete confirm, Photo upload, Plan create/edit, Trainer create/edit, Check-in/Check-out confirm.

Sidebar entries for pages not yet built render `PlaceholderPage` ("Coming in a later phase", US-1.7c).

---

## 8. Folder structure

```
hecules-fitness/
├─ docs/                              (existing: domain-context, requirements, architecture)
├─ public/
├─ index.html
├─ package.json  tsconfig.json  tsconfig.node.json  vite.config.ts  eslint.config.js
├─ .gitignore                         (.env, .env.local, dist, node_modules, .firebase)
├─ .env.example
├─ render.yaml                        (Render static site + SPA rewrite)
├─ firebase.json                      (rules + indexes + emulators; NO hosting/functions/storage)
├─ .firebaserc
├─ firestore.rules
├─ firestore.indexes.json
├─ README.md
├─ scripts/
│  ├─ seed.ts                         (Phase 2+, dev/emulator only, refuses the prod project id)
│  └─ reconcile.ts                    (Phase 8, read-only drift check)
├─ tests/
│  └─ rules/                          (emulator tests, §3.5)
└─ src/
   ├─ main.tsx  App.tsx  vite-env.d.ts
   ├─ config/env.ts                   (Zod-validated VITE_* config)
   ├─ firebase/app.ts                 (initializeApp, getAuth, getFirestore, emulator wiring)
   ├─ theme/index.ts
   ├─ constants/{roles.ts, routes.ts, navigation.ts, enums.ts, collections.ts}
   ├─ types/{user.ts, member.ts, membership.ts, payment.ts, attendance.ts, plan.ts,
   │         trainer.ts, audit.ts, notification.ts, common.ts, index.ts}
   ├─ domain/                         (pure, no Firebase, 100% unit-tested)
   │  ├─ dates.ts  status.ts  renewal.ts  money.ts
   │  ├─ search.ts                    (normalization + field inference)
   │  ├─ queryPredicates.ts           (statusConstraints, expiring windows)
   │  ├─ validation/                  (Zod schemas shared by forms and services)
   │  └─ csv.ts                       (escaping, BOM, formula neutralization)
   ├─ services/
   │  ├─ firestoreConverters.ts  errors.ts  txHelpers.ts  auditService.ts
   │  ├─ userService.ts  memberService.ts  memberPhotoService.ts  memberMedicalService.ts
   │  ├─ planService.ts  membershipService.ts  paymentService.ts  attendanceService.ts
   │  ├─ trainerService.ts  dashboardService.ts  reportService.ts  notificationService.ts
   │  └─ authService.ts
   ├─ context/{AuthContext.tsx, ToastContext.tsx}
   ├─ hooks/{useAuth.ts, useToast.ts, usePagedQuery.ts, useAsync.ts, useDebouncedValue.ts, ...}
   ├─ routes/{AppRoutes.tsx, RequireAuth.tsx, RequireRole.tsx, routeConfig.ts}
   ├─ layouts/{AppLayout.tsx, Sidebar.tsx, TopBar.tsx, AuthLayout.tsx}
   ├─ components/
   │  ├─ feedback/{LoadingState, EmptyState, ErrorState, ConfirmDialog, FullPageLoader}
   │  ├─ common/{PageHeader, DataTable, StatusBadge, MoneyText, IstDate, PlaceholderPage}
   │  ├─ form/{TextField, SelectField, IstDateField, MoneyField, FormActions}
   │  └─ <feature>/…                  (members/, memberships/, payments/, attendance/…)
   └─ pages/
      ├─ auth/{LoginPage, ForgotPasswordPage}
      ├─ DashboardPage  NotFoundPage  AccessDeniedPage  ConfigErrorPage  SettingsPage
      ├─ members/{MembersListPage, MemberRegisterPage, MemberProfilePage, MemberEditPage,
      │           ExpiringMembersPage, ExpiredMembersPage}
      ├─ plans/PlansPage   payments/{PaymentsPage, PendingPaymentsPage}
      ├─ attendance/{AttendancePage, MonthlyAttendancePage}
      ├─ trainers/TrainersPage   reports/ReportsPage
```

Unit tests live beside their subject as `*.test.ts(x)`; rules tests live in `tests/rules/`.

`firebase.json` (no Hosting, no Functions, no Storage):

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "emulators": { "auth": { "port": 9099 }, "firestore": { "port": 8080 }, "ui": { "enabled": true } }
}
```

`firebase-tools` is a **dev dependency only**, used for `firebase deploy --only firestore:rules,firestore:indexes` and `firebase emulators:exec`. It is not the Admin SDK and ships nothing to the browser.

---

## 9. Implementation plan

### Phase 1 — Scaffold, Auth, shell, baseline rules (detailed)

**Dependencies (install exactly these; nothing else in Phase 1).**

```
npm create vite@latest . -- --template react-ts

# runtime
npm i react-router-dom firebase @mui/material @mui/icons-material @emotion/react @emotion/styled \
      react-hook-form @hookform/resolvers zod luxon

# dev
npm i -D typescript @types/luxon vitest @vitest/coverage-v8 jsdom \
        @testing-library/react @testing-library/jest-dom @testing-library/user-event \
        @firebase/rules-unit-testing firebase-tools \
        eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh
```

Deliberately **not** installed yet: `@mui/x-date-pickers` (Phase 2), a chart library (`recharts`, Phase 2/3), `@mui/x-data-grid` (not needed — MUI `Table` is enough), any CSV library (Phase 6 uses `domain/csv.ts`; we need custom neutralization anyway), any image library (Phase 2 uses canvas), `uuid` (use `doc(collection(...)).id`).

**Environment variables** (`.env.example`, all required unless noted):

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
# optional, local development only
VITE_USE_EMULATORS=false
VITE_EMULATOR_HOST=127.0.0.1
```

`VITE_FIREBASE_STORAGE_BUCKET` is deliberately omitted — Storage is never initialized, and its absence is a visible reminder of the decision.

**Files to create**

| File | Contents |
|---|---|
| `index.html`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js` | Vite React-TS scaffold; `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride`; Vitest config (`environment: 'jsdom'`, `setupFiles`) |
| `.gitignore`, `.env.example`, `README.md` | README sections for Phase 1: prerequisites, Firebase project + Email/Password provider, env vars, local run, **first-admin bootstrap**, rules/index deploy, Render static-site settings incl. SPA rewrite and authorized domains |
| `render.yaml` | static site (see below) |
| `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json` | baseline rules (deny-all + `users` read-own, `allow write: if false`); empty index array |
| `src/config/env.ts` | Zod schema over `import.meta.env`; throws a typed `ConfigError` naming the missing key |
| `src/firebase/app.ts` | `initializeApp`, `getAuth`, `getFirestore`; `connectAuthEmulator`/`connectFirestoreEmulator` when `VITE_USE_EMULATORS` |
| `src/theme/index.ts` | MUI theme (palette, typography, dense tables, `DD/MM/YYYY` conventions) |
| `src/constants/roles.ts`, `routes.ts`, `navigation.ts` | `ROLES`, route path constants, sidebar items with `allow: Role[]` and `phase` |
| `src/types/{user,common,index}.ts` | `Role`, `UserDoc`, `AppUser`, `Result`/error types |
| `src/services/authService.ts` | `signIn`, `signOutUser`, `sendReset`, `observeAuth` |
| `src/services/userService.ts` | `getUserDoc(uid)` with converter |
| `src/services/errors.ts` | `AppError` + `mapFirebaseError(code)` → friendly message (NFR-4 list) |
| `src/context/AuthContext.tsx` | the state machine in §4.1 |
| `src/context/ToastContext.tsx` | snackbar queue provider |
| `src/hooks/{useAuth,useToast}.ts` | context hooks |
| `src/routes/{routeConfig.ts,AppRoutes.tsx,RequireAuth.tsx,RequireRole.tsx}` | route table + guards |
| `src/layouts/{AppLayout,Sidebar,TopBar,AuthLayout}.tsx` | shell, responsive drawer |
| `src/components/feedback/*` | `LoadingState`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `FullPageLoader` |
| `src/components/common/PlaceholderPage.tsx` | "Coming in a later phase" |
| `src/pages/auth/{LoginPage,ForgotPasswordPage}.tsx` | RHF + Zod forms |
| `src/pages/{DashboardPage,NotFoundPage,AccessDeniedPage,ConfigErrorPage,SettingsPage}.tsx` | placeholders |
| `src/main.tsx`, `src/App.tsx` | providers: Theme → Toast → Auth → Router |
| `src/services/errors.test.ts`, `src/routes/RequireRole.test.tsx` | Vitest (US-1.9, US-1.6d) |
| `tests/rules/baseline.test.ts`, `tests/rules/users.test.ts` | AC-10, AC-12 |

`package.json` scripts: `dev`, `build` (`tsc -b && vite build`), `preview`, `lint`, `typecheck`, `test`, `test:rules` (`firebase emulators:exec --only firestore "vitest run tests/rules"`), `deploy:rules`.

**Render configuration** (NEW-26: documented, first deploy optional):

```yaml
services:
  - type: web
    runtime: static           # older Render schema uses: env: static
    name: hercules-fitness
    buildCommand: npm ci && npm run build
    staticPublishPath: ./dist
    pullRequestPreviewsEnabled: false
    envVars:
      - key: VITE_FIREBASE_API_KEY
        sync: false
      - key: VITE_FIREBASE_AUTH_DOMAIN
        sync: false
      - key: VITE_FIREBASE_PROJECT_ID
        sync: false
      - key: VITE_FIREBASE_MESSAGING_SENDER_ID
        sync: false
      - key: VITE_FIREBASE_APP_ID
        sync: false
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

Manual Render steps documented in the README: create the Static Site from the repo, set the five env vars (they are baked in at build time, so a value change requires a redeploy), confirm the rewrite, then add `<name>.onrender.com` to Firebase Auth → authorized domains.

**Phase 1 done** = the definition already agreed in the requirements: admin logs in, sees the shell, navigates 8 placeholders, survives reload, is bounced after logout, non-admin/role-less is refused and signed out, all Firestore access except own `users` doc denied by emulator tests, `typecheck`/`lint`/`test` clean, `npm run build` produces `dist/`.

### Phases 2-8 (task breakdown)

| Phase | Deliverables | New collections / indexes | Key tests |
|---|---|---|---|
| **2. Members** | `domain/{dates,money,search}`, member types + Zod schemas, `counters` TX-1, registration form (no plan/payment sections, NEW-1), duplicate-mobile warn, photo pipeline + `memberPhotos`, `memberMedical`, consent + under-18, members list with prefix search + cursor pagination, profile page with empty sections, edit with concurrency guard, soft delete, trainers CRUD, audit for member events, dashboard slice (Total Members + new-members chart, other cards "-"), seed v1 | `members`, `memberMedical`, `memberPhotos`, `trainers`, `counters`, `auditLogs`; members search/createdAt/joiningDate indexes | member-ID concurrency, search normalization, validation matrix, photo limits, rules for members/medical/photos/counters/audit |
| **3. Plans, memberships, expiry** | `domain/{status,renewal,queryPredicates}`, plans CRUD + safe delete, assign/renew TX-2/TX-3, plan+dates sections added to the registration form, status badge, Expiring/Expired pages, list filters + sort, suspend/reactivate, dashboard status cards + plan chart + expiring table | `membershipPlans`, `memberships`; all `membership.endDate` indexes | the D-4 boundary matrix, the month-end table, renewal stacking, concurrent renewal, dashboard-vs-list agreement |
| **4. Payments** | payment TX-4 + void TX-5, payment section on registration/renew forms, payment history, payments list, pending list + report, revenue card/chart, audit for payments | `payments`; payment indexes, `memberships.unpaid` | balance maths in paise, overpayment, concurrent payments, idempotent double-submit, immutability rules |
| **5. Attendance** | check-in/out/absent (deterministic doc id), today's list, member history, monthly report, dashboard attendance cards/chart, expired-warn / suspended-block (NEW-12) | `attendance`; attendance indexes | IST day boundary (00:10 IST), double check-in, check-out ordering, month boundary |
| **6. Reports + CSV** | six reports with date filters, paged CSV export with progress and cap, formula neutralization, BOM, export audit record | (reuses indexes) | CSV escaping/injection, boundary-inclusive ranges, no medical notes in output |
| **7. Notifications** | `notificationService` interface + stub + `NotificationRecord` type, no UI writer (NEW-21), README note on deferred scheduled processing | `notifications` (type only) | stub reports "not delivered" |
| **8. Hardening + go-live** | full rules-test suite (one per matrix row), `getAfter` audit hardening (§3.4), clock-skew banner, read-budget measurement at 10k members, index audit, `scripts/reconcile.ts`, seed v2 covering every status, README 15 sections, production deploy + checklist | — | US-8.1 to US-8.6 |

Each phase ends runnable, type-clean, with its rules + indexes deployed and its README section added.

---

## 10. Key decisions, tradeoffs and risks

| # | Decision | Alternative rejected | Tradeoff |
|---|---|---|---|
| D1 | Rules + transactions are the only enforcement | server/Cloud Functions | No defence against a hostile authenticated client's *semantics*; see §1.3. Rules cover identity, role, shape, immutability, atomicity and two cross-document invariants |
| D2 | Money stored as integer paise | float rupees | Exactness and safe `increment()`; costs a conversion at the UI/CSV edge and less readable console values |
| D3 | Dates stored as Timestamps pinned to IST midnight | UTC midnight / strings | Exact IST range queries, device-timezone independent; every write must go through `fromCivilDate` (enforced by a shared Zod transform) |
| D4 | Member doc ID is an auto ID, `memberId` is a field | doc id = `GYM-2026-0001` | Enables pre-generated-ID idempotency and stable keys for photo/medical/attendance; deep links are opaque IDs |
| D5 | Status computed, never stored | daily batch status writes | No mass writes, no stale status (R-5 friendly); every status query is a date-range query, so `membership.endDate` must be maintained perfectly (R-2) |
| D6 | Live aggregation queries for the dashboard | maintained counters | Zero drift, ~52 aggregations per load; counters kept in reserve with an explicit adoption trigger (§5.5) |
| D7 | Search = prefix on normalized fields, disabled together with filters | third-party search (Algolia/Typesense) | No extra service or cost; no "contains" search, and combination #8 is unavailable (stated in the UI) |
| D8 | Photos as base64 in `memberPhotos/{id}` | Firebase Storage (Blaze) | No paid plan needed; capped at 100 KB, one photo per member, never shown in list rows; canvas re-encode strips EXIF |
| D9 | Luxon | date-fns(-tz), dayjs | Correctness and readability in the highest-risk code; one non-tree-shakeable dependency |
| D10 | Soft delete only | hard delete | History, revenue and audit survive; does **not** satisfy a DPDP erasure request on its own (NEW-16, R-6) — manual anonymization procedure documented in the README, owner/legal decision before production |
| D11 | Plan hard-delete after a `count()==0` check | soft-delete plans | Simpler UI; the residual create-during-delete race is benign because memberships snapshot plan name/duration/price |
| D12 | `domain/` layer added to the prescribed folder list | logic in `utils/` | Pure, mock-free unit tests for every high-risk rule |

**Risks carried forward**

- **R-1 Client trust.** Mitigated by rules (§3.3) and the Phase 8 `getAfter` audit hardening (§3.4); a determined ADMIN-authenticated client can still write rule-valid nonsense. Accepted by the user's stack decision.
- **R-2 Denormalization drift.** `members.membership.*`, `members.pendingPaise`, `memberships.paid/outstanding` power every list, count and card. Mitigated by: single-transaction updates (§2.7), a rules-enforced payment invariant, and `scripts/reconcile.ts`. A bug in any transaction shows up as wrong dashboard counts, not as lost history — `payments` and `memberships` remain the reconstructable source of truth.
- **R-3 Client clock/timezone.** Writes are bounded by `request.time` in rules; reads/display use the device clock. Skew banner in Phase 8. A device set to the wrong *year* would also pick the wrong ID counter — bounded because the counter rule only allows +1 and a wrong-year counter is visible in the ID.
- **R-4 Query-combination limits.** §5.3 is the contract; any new screen that wants an unsupported combination must be rejected in review or must add a denormalized field plus an index.
- **R-5 Free-plan quotas.** The Spark plan has daily read/write/delete quotas and aggregation queries have their own billing model. **Do not assume any specific number — verify the current Firebase limits and pricing before go-live** and record the measured per-screen read counts from US-8.3a against them. The design's defences are: no unbounded collection reads anywhere, page size 25, cursor pagination, aggregation instead of scans, dashboard caching with explicit refresh, and photos in a separate document. Note that every rules evaluation calling `get(users/{uid})` adds a billed read per request — a further reason to prefer fewer, larger queries.
- **R-6 Compliance.** Medical notes are structurally separated and Admin-only; minors are detected from DOB on the IST date and require guardian contact + guardian consent; no card data is stored (method + reference only, so PCI-DSS scope is avoided); CSV never includes medical notes; audit metadata carries field names, not values. **Erasure/retention and the consent wording remain owner/legal decisions** (NEW-16). GST/invoicing is confirmed out of scope.
- **R-7 Seed safety.** `scripts/seed.ts` refuses to run unless the target project id matches `VITE_FIREBASE_PROJECT_ID` of a dev project or the emulator is active, and it never requires a service-account key (it authenticates as a seeded admin user).
- **R-8 Photo size.** 1 MiB document limit; 100 KB cap plus a separate document keeps both the limit and read cost safe.
- **R-9 Rules document-access limits.** The `getAfter()` invariants consume access calls per commit. Verify the current per-request limits and prove the heaviest transaction passes (`tests/rules/budget.test.ts`); the documented fallback order is to drop the member-update audit check, then the membership audit check, keeping the payment invariant last.
- **R-10 Attendance and soft-delete.** A member soft-deleted mid-day may still be counted in *today's* attendance figures (attendance records carry no `deleted` flag, and back-filling one would be a fan-out write). Accepted and documented; all other counts and lists exclude soft-deleted members immediately (D-8).

---

## 11. Open questions for the user (architecture-level, none block Phase 1)

1. **Pending-payments report filter** (§5.7). The requirements' default filters it by membership start date; this design filters the member-level pending list by joining date instead, to avoid denormalizing a "member deleted" flag onto every membership. Confirm the substitution, or accept the extra fan-out write on soft-delete.
2. **Money in paise** (D2). Confirm that values appearing as `150000` for ₹1,500 in the Firebase console is acceptable (all app screens, CSV and reports show rupees).
3. **Opaque member URLs** (D4). Confirm that `/members/{docId}` instead of `/members/GYM-2026-0001` is fine; the readable ID stays visible and searchable everywhere.
4. **Luxon as the date library** (D9). Confirm, or state a preference for `date-fns` + `date-fns-tz`.
5. **Attendance and same-day soft delete** (R-10). Confirm the accepted limitation.
6. **Free-plan quotas** (R-5). Someone needs to check the current Firebase Spark limits and the aggregation-query pricing against the measured Phase 8 read counts before go-live — flagging that this is unverified here by design.
7. **DPDP erasure and retention** (R-6, NEW-16). Still an owner/legal decision: retention period, the manual anonymization procedure's exact field list, and the consent wording/version string used in `consent.version`.
8. **Render service name / custom domain.** Needed to add the authorized domain in Firebase Auth (§4.4) and to finalize `render.yaml`.
