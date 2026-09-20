# Requirement: Gym Management System
## Scope: New Module

> Full field lists, examples and prompts live in `/requirment.md` (original source spec). This file structures them for the SDLC chain and records decisions. **Where the two conflict, this file wins.**
> Last refined: 2026-09-19 (business-analyst validation pass). See "Validation Findings" for what changed and why.

## Business Goal
Give a gym owner one web app to register members, sell and renew memberships, track payments and attendance, and see at a glance who is active, expiring soon or expired. Firebase (Firestore + Authentication only) is the only backend; the app is hosted on Render. MVP is Admin-first, and the architecture must be ready for Staff and Member roles.

## Actors Involved
- Admin / Gym owner (MVP: full access; the only role with a UI in the MVP)
- Staff (architecture-ready; limited access; rules enforce limits from the phase each module is built)
- Member (architecture-ready; read-only on own data; no login UI in the MVP, see resolved Q4)
- Trainer (a record assigned to members, not a login role)
- ~~System: scheduled Cloud Function~~ Removed for the MVP (resolved Q1c). A Render Cron Job using the Admin SDK is a later option.

## Related Core Flows
Auth · Member registration · Membership plans · Assign plan / renew · Expiry status · Payments · Attendance · Dashboard · Reports & CSV · Audit log · Notification abstraction

## Affected Files
N/A, new project. Target structure: `src/{components,pages,layouts,routes,services,firebase,hooks,context,utils,types,constants,theme}`, plus `firestore.rules`, `firestore.indexes.json`, `.env.example`, `README.md`. (`functions/` and `storage.rules` from the source spec are removed per resolved Q1.)

---

## Definitions (shared vocabulary, applies to every FR and story)

**D-1 Today / calendar day.** "Today" is the current calendar date in `Asia/Kolkata` (IST). Every comparison of membership, payment or attendance dates uses IST calendar days, never raw UTC millisecond differences and never the device's local timezone. A stored date always denotes the same IST calendar day regardless of the device timezone that wrote or reads it (representation is for the architect).

**D-2 End date is inclusive.** A membership is valid through the whole of its `endDate` (IST). It becomes EXPIRED at 00:00:00 IST on the following day.

**D-3 daysRemaining.** `daysRemaining = endDate (IST day) − today (IST day)`, an integer. It is 0 on the end date, positive before it, negative after it. "Days since expiry" = `today − endDate` (an end date of yesterday = 1 day since expiry).

**D-4 Status rules (evaluated in this order).**

| Order | Condition | Status |
|---|---|---|
| 1 | Member/membership is suspended (stored flag) | SUSPENDED (daysRemaining is still calculated from dates and shown) |
| 2 | `daysRemaining < 0` | EXPIRED |
| 3 | `0 ≤ daysRemaining ≤ 7` | EXPIRING_SOON |
| 4 | `daysRemaining ≥ 8` | ACTIVE |

Boundary table, assuming today = 19/09/2026 (IST):

| End date | daysRemaining | Status |
|---|---|---|
| 18/09/2026 | -1 | EXPIRED (1 day since expiry) |
| 19/09/2026 (today) | 0 | EXPIRING_SOON (still valid today) |
| 20/09/2026 | 1 | EXPIRING_SOON |
| 26/09/2026 | 7 | EXPIRING_SOON (exactly 7 days out IS expiring soon) |
| 27/09/2026 | 8 | ACTIVE |

This resolves the source wording "within the next 7 days" as inclusive of day 7 and of today. The source AC "0–7 days" already matched.

**D-5 Member-level status and "current membership".** A member can have many memberships (renewals, early renewals, future-dated). The member's displayed status, expiry date, plan and days remaining come from the member's **latest end date across all their non-void memberships** (so an early renewal immediately moves the member's expiry to the new end date and the member drops off the Expiring page). SUSPENDED is a member-level flag (default, confirm in NEW-8). A member with no membership at all shows "No membership" (only possible in Phase 2 or if NEW-1 is answered differently).

**D-6 Money.** Currency INR. Amounts are non-negative, at most 2 decimal places, and all sums must be exact (no floating-point drift, e.g. 0.1 + 0.2 must total 0.30).

**D-7 Financial source of truth.** The `payments` collection is the only source of truth for money received. A membership stores its **total amount** (snapshot of the plan price at assignment time, unaffected by later plan edits). Per membership: `outstanding = membership.amount − sum(payments for that membership)`. Any stored "paid" / "outstanding" value is a denormalized copy that must be updated in the same atomic write as the payment. Member-level "Amount Pending" = sum of outstanding across all of that member's memberships (old unpaid dues carry forward, confirm in NEW-10). Payment state is derived, not a record type: UNPAID (paid = 0), PARTIAL (0 < paid < total), PAID (paid = total). "Pending payment" from the source therefore means "a membership with outstanding > 0", not a separate payment record.

**D-8 Soft-deleted members** are excluded from every list, count, search, attendance picker and dashboard figure, but their memberships, payments and audit records are retained. Revenue (cash received) still includes their payments.

---

## Functional Requirements

### FR-1 Authentication & RBAC
- Email/password login, logout, forgot password, protected routes.
- Role (ADMIN / STAFF / MEMBER) comes from a **server-controlled `users/{uid}` doc**, never from client-supplied data (custom claims are not available without the Admin SDK; resolved Q1).
- MVP builds the Admin UI; route guards and rules are role-aware from day one. Only ADMIN can enter the app in Phase 1 (see Phase 1 scope).
- Login of an authenticated user with no `users/{uid}` doc, an unknown role, or a role without a UI yet is denied with a clear message and the user is signed out.
- First admin is bootstrapped manually in the Firebase console (Auth user + `users/{uid}` doc with role ADMIN), documented in the README. Staff/Member accounts are also created in the console in the MVP (NEW-17).

### FR-2 Member registration & profile
- Auto-generated Member ID `GYM-YYYY-NNNN` via a client-side Firestore transaction on a per-year counter doc (resolved Q1/Q5). The counter increment and the member creation commit in the same transaction so no ID is consumed without a member. YYYY = IST year at registration. NNNN is zero-padded to 4 digits and grows to 5 digits after 9999 (GYM-2026-10000).
- Field lists per `requirment.md`, with these clarifications:
  - **Membership Status** is display-only on the form (computed, D-4). It is never an input. Suspension is done only through the Suspend action.
  - **Membership End Date** is auto-calculated from plan duration and start date (rule in FR-5). Whether Admin may override it is NEW-4.
  - **Total Amount / Amount Paid / Pending Amount / Payment Date / Mode / Reference** are governed by FR-6 (D-7): Total Amount comes from the plan (NEW-3), Amount Paid > 0 creates the first payment record, Pending Amount is read-only and computed, never typed and never stored independently of payments.
  - **Joining Date** (date the person first joined the gym, defaults to today, editable so existing members can be onboarded) is distinct from **Membership Start Date** (start of a membership period).
  - Medical Notes are Admin-only (confirmed). General Notes are visible to Staff read-only (Staff matrix, NEW-11).
- Duplicate member detection on mobile number (normalized: digits only, +91/0 prefix stripped, 10 digits starting 6-9; Indian mobiles only, from the India locale; NEW-14 for block vs warn).
- Profile photo (resolved Q1b): validate type, limit size, compress on the client to about 100 KB or less, store as a small image in a separate `memberPhotos/{memberId}` doc. Photo is optional. The stored image must not retain location/EXIF metadata. No Storage.
- Profile page sections: Profile, Membership, Payment History, Attendance History, Membership History, Notes, with a prominent status badge, start date, expiry date, days remaining.
- Required/optional/validation per field: see "Field validation matrix" (assumptions, NEW-15).

### FR-3 Membership plans
- Create / edit / activate-deactivate / delete only when safe (no membership, including those of soft-deleted members, references it).
- Fields: name, duration (value + unit days or months), price (INR), description, active flag, created/updated timestamps.
- Editing a plan never changes existing memberships (amount and dates are snapshots). A deactivated plan cannot be chosen for new memberships or renewals but stays visible on existing ones.
- Plan name unique, case-insensitive (assumption). Duration is a positive integer. Price is greater than 0 (assumption; a free plan is not supported unless the user says so).

### FR-4 Membership status & expiry
- `calculateMembershipStatus(startDate, endDate)` returns `{ status, daysRemaining }` per D-1 to D-4. Invalid input (end before start) is rejected, not silently computed. Whether a membership whose start is in the future is special is NEW-5 (default: status still derives from end date only).
- Status is computed dynamically. Only the SUSPENDED flag is stored. There is no daily mass status rewrite (resolved Q1c).
- **Query semantics.** Counts and lists must express each status as a query on the member's latest end date and the suspended flag, and the same predicate definition is used by the dashboard card, the members-list filter and the report so the numbers always agree:
  - ACTIVE: not suspended and `endDate ≥ today+8`
  - EXPIRING_SOON: not suspended and `today ≤ endDate ≤ today+7`
  - EXPIRED: not suspended and `endDate < today`
  - SUSPENDED: flag set
  - Partition rule: Total Members = Active + Expiring Soon + Expired + Suspended (+ No membership). No member is counted twice.

### FR-5 Membership assignment & renewal
- **Assign** (first membership for a member with none): start date is chosen (default today), end date computed.
- **Renew** creates a new `memberships` doc plus, if money is paid now, a payment. History is never overwritten.
- New start date:
  - If the member's latest end date is on or after today (member not yet expired, including end date = today): **new start = latest end date + 1 day** (corrects the source FR text "starts at the existing end date"; the resolved example 30/09 to 01/10 governs).
  - If the latest end date is before today (expired): **new start = today**. The uncovered gap days are not backfilled.
  - "Latest end date" includes future-dated memberships, so repeated early renewals stack.
- End date (resolved Q2): calendar-month plans: `start + N months − 1 day`, day plans: `start + N − 1 days`, inclusive. Month-end anchor behaviour is NEW-6 (worked examples below).
- Start/end are computed **inside the same atomic write that creates the membership**, from the freshly read latest end date, not from what the dialog showed when it opened (two admins, or a dialog left open past midnight, must not create overlapping or wrong periods).
- Renewal amount = selected plan price (NEW-3). Default plan = previous plan; if that plan is inactive the admin must choose another active plan.
- Renewal for a soft-deleted member is not allowed. Renewal of a SUSPENDED member is NEW-7.

Worked month arithmetic (rule as resolved; for the user to sanity-check under NEW-6):

| Start | Plan | End (start + N months − 1 day) |
|---|---|---|
| 01/10/2026 | 1 month | 31/10/2026 |
| 15/01/2026 | 1 month | 14/02/2026 |
| 31/01/2026 | 1 month | 27/02/2026 (28 days; 28-31 Jan starts all end 27/02) |
| 15/09/2026 | 12 months | 14/09/2027 |
| 29/02/2028 | 12 months | 27/02/2029 |

### FR-6 Payments
- Fields: payment ID, member ID, membership ID, amount, payment date, method, transaction reference, notes, created by (taken from the authenticated user, never from the form).
- Methods: Cash, UPI, Card, Bank Transfer, Other. No card data is ever stored.
- Each payment belongs to exactly one membership. The admin picks the membership when the member has several with outstanding balances (default: the oldest with outstanding > 0). No automatic allocation across memberships (NEW-10).
- Validation: amount > 0; amount ≤ that membership's current outstanding (resolved Q8, applied per membership). The check runs inside the same atomic write that records the payment and updates the denormalized totals (concurrent payments must not overpay). Payment date is not in the future (IST) (NEW-5).
- Payments are immutable for everyone in the MVP except a possible Admin "void" (NEW-9). Members and Staff can never create, edit or delete payments (resolved Q10).
- Computed: total membership amount, total paid, outstanding, payment state, at membership level and (sum) at member level.

### FR-7 Attendance
- One attendance record per member per IST day (resolved Q9). ABSENT exists only if an admin marks it explicitly.
- Fields: member ID, member name (snapshot), date, check-in time, check-out time, status PRESENT/ABSENT.
- **"Currently checked-in"** = today's (IST) attendance records with status PRESENT, a check-in time and **no check-out time**. Members with an unrecorded check-out on a previous day are not counted (the count is scoped to today and resets at 00:00 IST). It is a count of members, not of records.
- **Today's attendance (dashboard)** = number of today's records with status PRESENT (checked in at any time today, including those already checked out).
- Views: today's list, per-member history, monthly report.
- Whether expired/suspended members may be checked in is NEW-12.

### FR-8 Members list, expiring & expired pages
- Paginated server-side table (cursor-based, page size default 25, assumption), columns per source.
- Search by name, mobile and Member ID: **prefix, case-insensitive matching only** (no "contains"). Name matches the start of first name, last name or "first last" (NEW-25 to confirm). One search term at a time, the field is inferred from the input (digits = mobile, starts with "GYM" = Member ID, otherwise name; assumption).
- Filters: status, plan, expiry date range. Sort by expiry (asc/desc). Because Firestore cannot order by one field while range-filtering another, the supported combinations must be defined and documented by the architect; unsupported combinations must be disabled or explained in the UI. They must never be silently applied to only the current page. When a search term is active, results are ordered by the searched field, not by expiry.
- Actions: View, Edit, Renew, Payment, Attendance, Suspend, (Reactivate, added because Suspend needs an inverse), Delete (soft, resolved Q6). Actions not permitted for the role are hidden and also blocked by rules.
- **Expiring Soon page**: window selector 1/3/7/15 days (default 7). Window N lists members with `0 ≤ daysRemaining ≤ N` (so "1 day" = today and tomorrow), not suspended, based on the member's latest end date (a member who already renewed early is not listed). Columns: name, mobile, plan, expiry date, days remaining, pending amount, Renew. Sorted by days remaining ascending. Note windows of 8-15 days list members whose badge is still ACTIVE.
- **Expired page**: members with `daysRemaining < 0`, not suspended, columns per source. "Previous Plan" and "Previous Amount" refer to the member's latest membership (its plan and its total amount, assumption). Paginated, sorted by most recently expired first.

### FR-9 Dashboard
- Cards: Total Members, Active, Expiring ≤7 days, Expired, Today's Attendance, Currently Checked-in, Pending Payments, Current-month Revenue. Definitions:
  - Status cards use the FR-4 query semantics; each card links to the members list filtered with the same predicate.
  - Suspended count shown as a secondary card/label so the partition adds up (assumption).
  - Pending Payments = total outstanding amount (INR) with the number of members owing (assumption, NEW-19).
  - Current-month Revenue = sum of payment amounts whose payment date falls in the current IST calendar month (cash basis, not membership totals). Void payments excluded.
- Charts (default last 12 IST months, assumption): new members per month (by Joining Date), revenue per month (by payment date), attendance per month (PRESENT records), plan distribution (members whose current membership is ACTIVE or EXPIRING_SOON, grouped by plan; NEW-19).
- Table: "Memberships Expiring Soon", the 10 non-suspended members with the nearest end date within the next 7 days (`0 ≤ daysRemaining ≤ 7`), ascending; empty state if none.
- **Load rule (testable):** the dashboard must not read the members, payments or attendance collections in full. It may use aggregation queries (count/sum) or maintained counters, plus at most 10 document reads for the table. Counts are correct as of page load, and there is a refresh control. "Today" is recomputed on refresh so a dashboard left open across midnight IST is not silently stale.

### FR-10 Reports
- Member, Expired, Expiring, Revenue, Attendance, Pending-payment reports with date filters and CSV export. Date filter meaning per report is defined in US-6.1 (assumptions, NEW-20).
- CSV: UTF-8 (with BOM so Excel shows non-Latin names correctly), dates `DD/MM/YYYY`, amounts as plain numbers, cells starting with `=`, `+`, `-`, `@` neutralized (CSV/formula injection), never includes medical notes. Large exports are fetched in pages with progress and a clear cap or warning, never one unbounded read.
- Admin only (NEW-11/NEW-20).

### FR-11 Notifications (abstraction only)
- `notificationService` interface and a notification record type. Stub implementation only, no external provider, nothing is delivered in the MVP.

### FR-12 Scheduled processing / Cloud Functions: DEFERRED
- Superseded by resolved Q1c. No Cloud Functions in the MVP. Member ID allocation runs as a client transaction and roles come from the `users` doc. Scheduled expiry notifications are a later option (Render Cron + Admin SDK) and outside this scope. Original AC 18 is parked.

### FR-13 Audit log
- Append-only records: member created/updated/soft-deleted, membership created/renewed/suspended/**reactivated**, payment created (and voided, if NEW-9 adopts void). Fields: user (uid + display name), action, entity, entityId, timestamp, metadata.
- Written by the client in the **same atomic write** as the audited action (so an action cannot commit without its audit record). Rules allow create only, never update or delete.
- Metadata for "member updated" lists changed field names, and must not copy medical-note content or other sensitive values.
- Limitation to accept: with no server-side component, a modified client could skip writing an audit record for its own changes. Rules can only partially prevent this (documented risk).
- Viewer UI is not in the MVP (NEW-22).

### FR-14 Seed data & docs
- Dev seed: 5 members, 3 plans, 10 payments, attendance, admin bootstrap instructions. Seed must respect the same invariants (IDs from the counter, denormalized totals consistent), use dates relative to today so every status is represented (including a member expiring exactly today and exactly in 7 days, an expired member, a suspended member), and must never run against the production project or require committing a service-account key.
- README (15 sections in `requirment.md`) adapted to the resolved stack: section 8 becomes "Profile photos in Firestore", 11 becomes "Render deployment plus rules/indexes deployment", 14 becomes "Scheduled processing (deferred)".
- Seed and README are delivered incrementally, each phase adds its data and its README sections; final polish in Phase 8.

### FR-15 Trainers & Settings (PENDING: not covered by the source beyond a sidebar entry and a Trainer field)
- Trainer is a field on the registration form and a `trainers` collection exists. No CRUD, fields or phase were specified. See NEW-2. Until answered, Phase 2 treats Trainer as an optional selection from Admin-managed trainer records (name, mobile, active), and Settings as a placeholder page.

### FR-16 Privacy & consent (DPDP)
- Registration records that the member (or guardian, for under-18) consented to data processing for gym administration, with a timestamp and the acknowledging user. Under-18 detection is by DOB on the IST date. Erasure/retention handling is NEW-16. Consent wording needs legal review (not decided here).

### FR-17 App shell & shared UX (missing from the source; needed for Phase 1)
- Sidebar (Dashboard, Members, Membership Plans, Payments, Attendance, Trainers, Reports, Settings), top bar with user name/role and logout, responsive drawer on mobile, 404 page, toast notifications, confirm dialog, loading / empty / error states, friendly error mapping (Firebase unavailable, permission denied, invalid data, duplicate member, payment failure, upload failure, network error).

---

## Permission Matrix (Admin vs Staff per module)

Target permissions. UI hiding is not security: Firestore rules must enforce each row, and each row needs a rules test. `A` = assumption not stated by the user (derived from the source or resolved Q10), confirm in NEW-11. Member column is for future login (resolved Q4).

| Module / action | Admin | Staff | Member (future) |
|---|---|---|---|
| Login / own `users` doc read | Yes | Yes | Yes |
| Write any `users` doc / change a role | No via app (console only, NEW-17) | No | No |
| View members list / profile (non-medical) | Yes | Yes | Own only |
| Register member | Yes | Yes, without the payment section and without medical notes (derived from Q10 and Medical=Admin-only; A) | No |
| Edit member profile | Yes | No (A) | No |
| Medical notes read/write | Yes | **No (confirmed)** | No |
| General notes | Read/write | Read only (A) | No |
| Profile photo view / upload | Yes / Yes | Yes / at registration only (A) | Own view |
| Suspend / reactivate / soft-delete member | Yes | No (A) | No |
| Plans: view | Yes | Yes | No |
| Plans: create/edit/activate/delete | Yes | No | No |
| Assign plan / renew | Yes | No (A: involves money) | No |
| View membership status & expiry | Yes | Yes | Own |
| Record payment | Yes | **No (Q10)** | No |
| View payment history / revenue | Yes | No (A) | Own payments |
| See "Amount Pending" on list/profile | Yes | Yes, read-only (A) | Own |
| Void payment (if NEW-9) | Yes | No | No |
| Attendance: mark check-in/out/absent | Yes | Yes | No |
| Attendance: edit/delete/backdate | Yes | No (A) | No |
| Attendance: today's list / member history | Yes | Yes | Own history |
| Dashboard | Full | Non-financial cards only (A) | No |
| Reports & CSV | Yes | No (A: bulk PII export) | No |
| Trainers | Manage | Read | No |
| Settings | Yes | No | No |
| Audit log: create (as part of an action) | Yes | Yes (for actions they may perform) | No |
| Audit log: read / update / delete | Read: Yes (NEW-22) / never | No / never | No / never |

---

## Field validation matrix (proposed, confirm in NEW-15)

| Field | Rule |
|---|---|
| First name, Last name | Required, trimmed, 1-50 chars |
| Gender | Required, one of MALE / FEMALE / OTHER (assumption) |
| Date of birth | Required (needed for under-18 detection), not in the future, age ≤ 100 |
| Mobile | Required, normalized to 10 digits starting 6-9 |
| Email | Optional, valid format when present |
| Address | Optional |
| Emergency contact name + mobile | Required for under-18 (guardian); optional otherwise; both-or-neither; mobile valid format |
| Membership plan | Required when assigning a membership; must be active |
| Membership start date | Required, valid date (see NEW-5 for past/future) |
| Joining date | Required, not in the future, defaults to today |
| Trainer | Optional |
| Amount paid | 0 ≤ paid ≤ total amount |
| Payment mode | Required only when amount paid > 0 |
| Transaction reference | Optional for Cash; required-ness for other modes is NEW-15 |
| Payment date | Required only when amount paid > 0, defaults today, not in the future |
| Medical / General notes | Optional, max length 1000 (assumption) |
| Photo | Optional; JPEG/PNG/WebP; input ≤ 5 MB; output ≤ about 100 KB after compression |

---

## Domain-Specific Considerations

**Regulatory / Compliance (from domain-context.md)**
- DPDP Act 2023: consent and purpose for personal data, deletion path, minimal collection. My understanding is that the Act requires verifiable guardian consent for children (under 18) and supports erasure requests, but I have not verified the current commencement status of the Rules, so treat this as a flag to confirm with legal advice, not a settled requirement. Note the tension: resolved Q6 offers soft-delete only, which does not by itself satisfy an erasure request (NEW-16).
- Medical notes are Admin-only (confirmed). Enforce in the data model (separate doc, e.g. `memberMedical/{memberId}`) because Firestore rules cannot hide single fields. The same reasoning applies to the photo doc (keeps list reads cheap) and to CSV exports (never included).
- Minors: capture DOB, flag under-18 in the UI and require guardian details in the emergency contact.
- No card data stored (mode and reference only). GST/invoicing is out of MVP scope (confirmed).
- No secrets in the repo; `.env` git-ignored, `.env.example` provided. Firebase web config is not secret, but rules are the only protection.

**High-Risk Areas mapped to edge cases and stories**

| High-risk area | Edge cases to cover | Stories |
|---|---|---|
| Timezone / date bugs | Now = 23:59:59 vs 00:00:00 IST; 18:30 UTC (= 00:00 IST next day); device set to UTC or US timezone; end date = today; exactly 7 and 8 days; midnight rollover with page open; wrong device clock (client-side "today", risk R-3) | US-3.4, US-3.6, US-3.9, US-2.12 |
| Renewal logic / month-end | Early renewal, renewal on end date, renewal day after end date, stacked early renewals, 31 Jan starts, leap year, dialog open across midnight, two admins renewing at once | US-3.5, US-3.6, US-3.7 |
| Duplicate Member IDs | Two simultaneous registrations, failed transaction (no gap), year rollover at 00:00 IST 1 Jan, >9999 in a year, offline retry | US-2.2 |
| Payment integrity | Overpayment, concurrent payments, negative/zero, decimals, double-click submit, retry after a timeout that actually committed, member/staff writes, payment against wrong membership | US-4.1 to US-4.4 |
| Denormalized totals | Payment + total update in one atomic write; void adjusts totals; deleted member's dues | US-4.1, US-4.3, US-4.7 |
| Firestore rules | Role forgery, unauthenticated access, missing `users` doc, Staff reading medical notes, member reading another member, expiry write by member | US-1.9, US-8.2 |
| Deleting members/plans | Delete plan referenced by a soft-deleted member's membership; delete member with dues or active membership; audit retained | US-2.11, US-3.3 |
| Query limits | Search + filter + sort combinations, 10k+ members, page boundary, empty page | US-2.8, US-3.8, US-8.3 |
| Unnecessary writes | No mass status writes; audit + denormalized writes only when an action occurs | US-3.4, US-3.12 |
| Photo upload | Wrong type, oversized, cannot be compressed under limit, corrupt image, failure mid-save | US-2.5 |
| Health data (PHI) | Staff/Member never receive medical notes; not in audit metadata, CSV, logs or list reads | US-2.6, US-6.2 |
| Minors / consent | DOB makes member under 18 today; turns 18 later; consent missing | US-2.7 |

## Non-Functional Requirements
- NFR-1 TypeScript strict, no unnecessary libraries. Allowed: React Hook Form + Zod, a chart library, a date library with timezone support (architect chooses).
- NFR-2 Desktop-first, responsive to mobile. Loading, empty and error states, toasts, confirm dialogs.
- NFR-3 Server-side pagination on all lists. Documented indexes.
- NFR-4 Friendly errors for: Firebase unavailable, permission denied, invalid data, duplicate member, payment failure, upload failure, network error. Raw Firebase error codes are never shown to the user.
- NFR-5 Dates: Firestore Timestamp, display `DD/MM/YYYY`, timezone `Asia/Kolkata`. Currency INR.
- NFR-6 Tests (Vitest): status calc, expiring-soon, renewal, payment balance, validation, role permissions (rules emulator).
- NFR-7 Hosting: Render static site built from Vite, SPA rewrite `/* → /index.html`. Firebase is used only for Firestore and Auth. Each phase leaves the app runnable and type-clean.
- NFR-8 Firebase client config via `VITE_*` env vars set in the Render dashboard; Render domain added to Firebase Auth authorized domains.
- NFR-9 Read/write economy: the free Spark plan has daily read/write quotas (verify current limits), so "never load whole collections" is a hard requirement, not an optimization. Rules that call `get()` on the `users` doc add reads and have per-request limits; architect to account for this.
- NFR-10 Layering: no Firebase calls directly in components (services / business logic / utils / types).

---

## Cross-cutting Acceptance Criteria (original 18, updated)

| # | Criterion | Phase | Change |
|---|---|---|---|
| 1 | **Status ACTIVE**: end date is 8+ days from today (IST) then ACTIVE and daysRemaining correct | 3 | as before |
| 2 | **Status EXPIRING_SOON**: end date is 0 to 7 days away (today and exactly 7 days included) then EXPIRING_SOON | 3 | clarified |
| 3 | **Status EXPIRED**: end date before today (IST) then EXPIRED | 3 | as before |
| 4 | **SUSPENDED wins**: suspended then SUSPENDED regardless of dates | 3 | as before |
| 5 | **Renew early**: ends 30/09/2026, renewed 1 month on 25/09/2026, then new period 01/10/2026 to 31/10/2026 and the old record is unchanged | 3 | as before |
| 6 | **Renew expired**: expired 30/09/2026, renewed on 10/10/2026, then new period starts 10/10/2026 | 3 | as before |
| 7 | **Unique IDs**: two admins register at the same instant then IDs are distinct and sequential | 2 | as before |
| 8 | **Payment balance**: total 1500 and payments 500 + 700 then outstanding 300. Overpayment and negative amounts rejected | 4 | as before |
| 9 | **Validation**: end before start, invalid mobile, invalid email or negative payment blocks submission with a clear message | 2-4 | as before |
| 10 | **Unauthenticated**: no login then all Firestore reads/writes denied and protected routes redirect to login | 1 | Storage removed |
| 11 | **Member isolation**: a MEMBER reads only own member/membership/payment/attendance docs and cannot write payments or expiry dates | 8 (rules written per module) | as before |
| 12 | **Role forgery**: client writing `role: ADMIN` to its own user doc is denied | 1 | as before |
| 13 | **Members list scale**: 10k+ members load one page at a time, search/filter use indexed server-side queries | 2-3, 8 | as before |
| 14 | **Photo upload**: non-image or oversized file rejected with a friendly message; valid images compressed and stored as a small image in `memberPhotos/{memberId}` | 2 | URL wording replaced (resolved Q1b) |
| 15 | **Audit**: any audited action has an append-only record with user, action, entity, id, timestamp | 2-4 | as before |
| 16 | **Dashboard**: cards and charts correct without loading the entire members collection | 2-5 | as before |
| 17 | **Expiring page**: selecting 1/3/7/15 lists only members with 0 ≤ daysRemaining ≤ N, with days remaining and pending amount | 3 | clarified |
| 18 | ~~Scheduled function idempotent notification records~~ | Deferred | No Cloud Functions (resolved Q1c) |

---

## User Stories by Implementation Phase

Notation: `US-<phase>.<n>`, criteria are `a, b, c` within each story. All dates below are IST. Example "today" = 19/09/2026 unless stated. Stories marked (NEW-x) depend on an unanswered question and use the stated default until answered.

Phase map (adjusted from `requirment.md`): Phase 7 no longer includes Cloud Functions or scheduled processing (deferred, FR-12). Phase 2 cannot assign plans because plans arrive in Phase 3 (NEW-1). Trainers/Settings have no phase in the source (NEW-2).

### Phase 1 scope (React + Vite + TS, MUI, Firebase config, Auth, admin login, protected routes, layout)

**In scope**
1. Project scaffold: React 18 + TypeScript (strict) + Vite, MUI theme, React Router, the target folder structure, `.gitignore` excluding `.env`, `.env.example` with all `VITE_FIREBASE_*` keys, minimal README (prerequisites, Firebase project + Email/Password Auth setup, env vars, local run, first-admin bootstrap steps, Render static-site settings incl. the SPA rewrite and authorized-domain step documented).
2. Firebase initialization for **Auth and Firestore only**, with startup validation of the required env vars.
3. Auth: email/password login, logout, forgot password, persistent session with an auth-loading state.
4. Role resolution from `users/{uid}`. Auth context exposes user + role. Route guard is role-aware (accepts allowed roles). Only ADMIN gets in during Phase 1.
5. Protected routes and redirect-to-login / redirect-back-after-login. 404 route.
6. App shell: sidebar with all 8 items, top bar with user + logout, responsive drawer. Destinations not yet built render a "Coming in a later phase" placeholder (assumption). Dashboard route renders a placeholder page with no KPIs.
7. Shared UX primitives: toast provider, loading / empty / error state components, confirm dialog component, Firebase error to friendly message mapping.
8. Baseline `firestore.rules` (deny by default; signed-in user may read only their own `users/{uid}`; no client writes to `users`) deployed to the Firebase project, with emulator tests for unauthenticated denial (AC-10) and role forgery (AC-12).
9. Vitest configured, with tests for the route guard/role check and the error-message mapping.

**Out of scope for Phase 1**
- Any member, plan, membership, payment, attendance, trainer, report, settings functionality, and any Firestore collection other than `users`.
- Dashboard KPIs/charts, date utilities and `calculateMembershipStatus` (Phase 2/3).
- Staff and Member UI (guards support roles; screens do not exist). Admin UI for creating users/roles (console only, NEW-17). Change password, profile edit, email verification, MFA, dark mode, i18n, analytics.
- Seed data, full README (15 sections), executing the production deploy on Render (documented only; a first deploy is optional, formal go-live is Phase 8).
- Firebase Storage, Cloud Functions, Firebase Hosting (never used).

**Phase 1 done means:** an ADMIN can log in with the bootstrapped account, sees the shell, navigates all 8 sidebar entries (placeholders), refreshes without being logged out, logs out and is bounced from protected URLs; a non-admin or role-less account is refused; all Firestore access except reading own `users` doc is denied per emulator tests; `tsc` and lint are clean; app builds for Render.

#### US-1.1 Login (FR-1)
As an Admin, I want to sign in with email and password, so that only I can manage the gym.
- a. Given a bootstrapped ADMIN account, when I submit correct credentials, then I land on the dashboard placeholder inside the app shell.
- b. Given a wrong password or an unknown email, when I submit, then I see one generic message ("Invalid email or password") that does not reveal which was wrong.
- c. Given an empty field or malformed email, when I submit, then inline validation blocks the request and no network call is made.
- d. Given many failed attempts (Firebase "too many requests"), then I see a friendly "try again later or reset your password" message, not a raw error code.
- e. Given the device is offline or Firebase is unreachable, then I see a network/unavailable message and the form stays filled.
- f. Given a request is in flight, then the submit button is disabled (no double submit).

#### US-1.2 Session persistence (FR-1)
As an Admin, I want to stay signed in across reloads, so that I am not repeatedly asked to log in.
- a. Given I am signed in, when I reload, then I see a loading state and then the same page, never a flash of the login page.
- b. Given I am signed out, when I reload a protected URL, then I land on login.
- c. Given I sign out in one tab, when I interact in another tab, then that tab redirects to login.
- Session length/idle timeout policy: NEW-18.

#### US-1.3 Logout (FR-1)
As an Admin, I want to sign out, so that nobody else uses my session on a shared computer.
- a. Given I am signed in, when I click Logout, then I return to login, and Back does not show protected content.
- b. Given I logged out, when I open a protected URL, then I am redirected to login.

#### US-1.4 Forgot password (FR-1)
As an Admin, I want to reset my password by email, so that I can regain access.
- a. Given the login page, when I choose Forgot password and submit a valid email, then I see a generic confirmation ("If an account exists, a reset link has been sent") whether or not the email exists.
- b. Given an invalid email format, then validation blocks it.
- c. Given a network failure, then a friendly error is shown and I can retry.
- The reset link opens Firebase's standard hosted reset page (custom branding is out of scope).

#### US-1.5 Protected routes (FR-1)
As the owner, I want every app page to require login, so that data is never shown to anonymous visitors.
- a. Given no session, when I open any app URL, then I am redirected to login and no app data is fetched.
- b. Given I was redirected from `/members`, when I log in, then I go back to `/members` (or the dashboard if it is not permitted).
- c. Given an unknown URL, then I see a 404 page with a link home (inside the shell if signed in, otherwise redirect to login).

#### US-1.6 Role resolution and access control (FR-1)
As the owner, I want the role to come from a server-controlled record, so that nobody can grant themselves access.
- a. Given a signed-in user whose `users/{uid}` has role ADMIN, then the app opens.
- b. Given a signed-in user with no `users/{uid}` doc, an unknown role value, or role STAFF/MEMBER (no UI in Phase 1), then I see "You do not have access to this application" and am signed out.
- c. Given the role doc cannot be loaded because of a network error, then I see a retryable error, and no protected UI is rendered while the role is unknown.
- d. Given the route guard is called with `allowedRoles=[ADMIN]`, when the role is STAFF, then access is denied (unit test), so Staff/Member screens can later be added without redesign.

#### US-1.7 App shell (FR-17)
As an Admin, I want a sidebar and top bar, so that I can navigate the system.
- a. Given I am signed in on desktop, then I see the sidebar with Dashboard, Members, Membership Plans, Payments, Attendance, Trainers, Reports, Settings, with the current page highlighted, and a top bar with my name/role and Logout.
- b. Given a screen width below the mobile breakpoint, then the sidebar becomes a drawer opened from the top bar, and content is usable without horizontal scrolling.
- c. Given I click a not-yet-built item, then I see the "Coming in a later phase" placeholder, not an error.

#### US-1.8 Configuration safety (NFR-8)
As a developer/owner, I want config kept out of the repo, so that the project is safe to share.
- a. Given a fresh clone, then `.env.example` lists every required `VITE_*` key with no real values, and `.env` is git-ignored.
- b. Given a required env var is missing at startup, then a clear configuration error screen names the missing key (not a blank page).
- c. Given the built app, then it contains no Admin SDK credential or service-account key.

#### US-1.9 Baseline security rules (FR-1, AC-10, AC-12)
As the owner, I want deny-by-default rules from day one, so that the database is never open.
- a. Given no authentication, when any read or write to any path is attempted, then it is denied (emulator test).
- b. Given a signed-in user, when they read their own `users/{uid}`, then it is allowed; reading another user's doc is denied.
- c. Given a signed-in user, when they write `role: ADMIN` to their own `users/{uid}` (create or update), then the write is denied.
- d. Given an unlisted collection path, then access is denied.

#### US-1.10 Shared UX primitives (FR-17, NFR-4)
As an Admin, I want consistent feedback, so that I always know what happened.
- a. Given any service error, then the UI shows a mapped friendly message per NFR-4 and never a raw error code or stack.
- b. Given an action succeeds or fails, then a toast appears and auto-dismisses.
- c. Given a destructive action, then a confirm dialog with an explicit confirm button appears before any write.

---

### Phase 2 (Dashboard shell, Members, Registration, Profile, Search)

Phase 2 data only includes members (and trainers per NEW-2). With NEW-1 default, no plan/membership/payment/attendance exists yet.

#### US-2.1 Register a member (FR-2)
As an Admin, I want to register a member with all personal and gym details, so that the gym has a complete record.
- a. Given valid required fields, when I submit, then a member is created with the next Member ID, joining date, a consent record (US-2.7), an audit entry, and I am taken to the member's profile with a success toast.
- b. Given the Membership Status field appears on the form, then it is read-only/derived (or "No membership" in Phase 2), never an editable input.
- c. Given I submit while offline or Firebase fails, then nothing is partially created (no member without its ID counter update, no ID consumed) and I see a retryable error with my input preserved.
- d. Given I click Submit twice quickly, then only one member is created.
- e. (NEW-1) Given Phase 2, then the Plan/Start/End/Payment sections are absent or disabled with a note, and are added to this same form in Phases 3 and 4.

#### US-2.2 Unique sequential Member IDs (FR-2, AC-7)
As the owner, I want IDs that never collide, so that every member is unambiguous.
- a. Given the last 2026 ID is GYM-2026-0007, when two admins submit at the same instant, then the two members get GYM-2026-0008 and GYM-2026-0009 in some order, with no duplicates and no skipped number.
- b. Given a registration transaction fails and rolls back, then the next registration gets the number the failed one would have had (no gap).
- c. Given the first registration after 00:00 IST on 01/01/2027, then the ID is GYM-2027-0001 even if the device timezone is not IST.
- d. Given the year's counter passes 9999, then IDs continue as GYM-2026-10000 without error.
- e. Given the counter doc does not exist yet for a year, then it is created safely inside the same transaction.

#### US-2.3 Duplicate mobile detection (FR-2, NEW-14)
As an Admin, I want to be told if a mobile is already registered, so that I do not create duplicate people.
- a. Given a member with mobile 9876543210 exists, when I enter "+91 98765 43210" or "09876543210", then it normalizes to the same number and the duplicate is detected.
- b. Given a duplicate is detected, then I see the existing member's name and ID with a link, and (default) must explicitly confirm to continue (families may share a phone).
- c. Given the only match is a soft-deleted member, then the message says so and registration is allowed.
- d. Given two admins register the same new mobile at once, then the outcome is documented (best effort with default warn-mode; an atomic unique guard is required if NEW-14 is answered "block").

#### US-2.4 Registration validation (FR-2, AC-9)
As an Admin, I want clear validation, so that bad data does not enter the system.
- a. Given a required field is empty, when I submit, then it is highlighted with a specific message and nothing is saved.
- b. Given a mobile that is not 10 digits starting 6-9, an email without a valid format, a future DOB, or a future joining date, then submission is blocked with a message per field.
- c. Given emergency contact name is filled but mobile is empty (or vice versa), then submission is blocked.
- d. Given leading/trailing spaces in names, then values are trimmed before saving.

#### US-2.5 Profile photo (FR-2, AC-14)
As an Admin, I want to attach a photo, so that staff can recognise members.
- a. Given a JPEG/PNG/WebP up to 5 MB, when I select it, then it is compressed on the client and shown as a preview, and the stored image is 100 KB or less.
- b. Given a PDF, GIF, renamed non-image, or a file over 5 MB, then it is rejected with a friendly message and nothing is uploaded.
- c. Given an image that cannot be compressed to the limit, or a corrupt image, then a friendly message is shown and the form remains usable without a photo.
- d. Given the photo write fails after the member is created, then the member exists, I am told the photo failed, and I can retry from the profile (member data is not lost).
- e. Given the photo is stored, then it lives in `memberPhotos/{memberId}` (not in the member doc, so list reads stay small) and contains no EXIF/location data.
- f. Given I replace the photo, then the old one is overwritten (one photo per member).

#### US-2.6 Notes and medical data restriction (FR-2, compliance)
As the owner, I want medical notes visible to Admin only, so that health data is protected.
- a. Given I am ADMIN, then I can read and write both note types on the profile and registration form.
- b. Given I am STAFF, then the medical notes field and profile section are not rendered, and a direct read of the medical data is denied by rules (emulator test).
- c. Given any audit record, CSV export, list query or log, then medical-note content never appears.

#### US-2.7 Minors and consent (FR-16)
As the owner, I want guardian details and consent captured, so that I handle minors' data responsibly.
- a. Given DOB gives an age under 18 on today's IST date, then the form shows an "Under 18" notice and requires emergency-contact (guardian) name and mobile.
- b. Given consent is not acknowledged, then submission is blocked (for under-18 the consent is described as guardian consent).
- c. Given a member registered as under 18, then the profile shows an "Under 18" flag until the IST date they turn 18, computed dynamically.
- d. Given consent, then the profile shows when it was recorded and by whom.
- Legal wording and retention are NEW-16.

#### US-2.8 Members list, pagination and search (FR-8, AC-13)
As an Admin, I want a fast, searchable members list, so that I can find anyone quickly.
- a. Given 10,000+ members, when I open Members, then only the first page (default 25) is loaded, with next/previous paging, and the number of documents read does not grow with total members.
- b. Given I type "rah", then results are members whose first name, last name or full name starts with "rah", case-insensitive; typing "ahul" does not match "Rahul" (prefix-only, stated in the UI hint).
- c. Given I type a mobile prefix "98765" or "GYM-2026-00", then results match by prefix on mobile / Member ID respectively.
- d. Given no matches, then an empty state is shown; given a query failure, an error state with retry is shown.
- e. Given I clear the search or change it quickly, then stale earlier results never overwrite newer ones.
- f. Given soft-deleted members, then they never appear.
- Status/plan/expiry filters and sort by expiry are added in Phase 3 (US-3.8).

#### US-2.9 Member profile (FR-2)
As an Admin, I want a full profile page, so that I see everything about a member in one place.
- a. Given I open a member, then I see sections Profile, Membership, Payment History, Attendance History, Membership History, Notes, plus photo, Member ID, joining date.
- b. Given a section's data is not available yet (Phase 2), then it shows an explicit "No data yet" empty state.
- c. Given an ID that does not exist or belongs to a soft-deleted member, then I see a "Member not found" state.
- d. Given Phases 3-5 add data, then the status badge, start date, expiry date and days remaining are prominent at the top (US-3.13).

#### US-2.10 Edit member (FR-2, FR-13)
As an Admin, I want to correct member details, so that records stay accurate.
- a. Given I change name or address and save, then the member updates, `updatedAt` changes, and an audit "member updated" record lists the changed field names only.
- b. Given I change the mobile to one used by another member, then the duplicate rule (US-2.3) applies.
- c. Given I try to change Member ID, joining-date-derived fields, or membership dates here, then it is not possible (Member ID immutable; membership changes go through assign/renew).
- d. Given two admins edit the same member, then the second save does not silently overwrite the first (detect the conflict and ask to reload).

#### US-2.11 Soft-delete member (FR-8, FR-13, resolved Q6)
As an Admin, I want to remove a member from view without losing history, so that financial and audit records survive.
- a. Given I choose Delete, then a confirm dialog states the effect and, if the member has outstanding dues or an active membership (Phase 3+), shows a warning (NEW-24 default: warn, do not block).
- b. Given I confirm, then the member is flagged deleted, disappears from lists, counts, search, attendance pickers and reports, and an audit "member deleted" record is written.
- c. Given the member's payments and memberships, then they remain in the database and payments still count in revenue.
- d. Given the member is deleted, then their profile URL shows "Member not found", and there is no hard-delete option anywhere in the UI.
- Restore/erasure: NEW-16, NEW-24.

#### US-2.12 Dashboard, Phase 2 slice (FR-9)
As an Admin, I want to see gym numbers at a glance, so that I start the day informed.
- a. Given I open Dashboard, then the Total Members card shows the count of non-deleted members using an aggregation/counter and not by loading all members.
- b. Given cards whose data does not exist yet (Active, Expiring, Expired, Attendance, Pending, Revenue), then they show "-" with a "Available after Phase N" hint, not a misleading 0 (NEW-1).
- c. Given the "New members by month" chart, then it groups by Joining Date over the last 12 IST months, and a member joined at 00:30 IST on the 1st counts in the new month.
- d. Given a refresh action, then values reload; given a load failure, then the cards show an error state with retry.

#### US-2.13 Trainers (FR-15, NEW-2)
As an Admin, I want to maintain trainers, so that I can assign one to a member.
- a. Given the Trainers page, when I add a trainer with name (required) and mobile, then it appears in the list and in the registration Trainer dropdown.
- b. Given a trainer assigned to members, when I deactivate the trainer, then existing assignments remain but the trainer is not selectable for new ones; a trainer cannot be deleted while assigned.
- c. Given I am STAFF, then I can read but not change trainers.

#### US-2.14 Audit for member events (FR-13, AC-15)
As the owner, I want a trail of who changed what, so that I can investigate issues.
- a. Given member created / updated / deleted, then one audit record exists with user, action, entity=member, entityId, timestamp, metadata.
- b. Given the audit record is written in the same atomic write as the change, then a failed change leaves no audit record and a successful change always has one.
- c. Given any client attempts to update or delete an audit record, then rules deny it (emulator test).

---

### Phase 3 (Plans, Assignment, Expiry, Expiring/Expired, Renewal)

#### US-3.1 Manage plans (FR-3)
As an Admin, I want to create and edit plans, so that I can sell memberships.
- a. Given name "Monthly", duration 1 month, price 1500, when I save, then the plan is created active with created/updated timestamps.
- b. Given a duplicate name (case-insensitive), a duration that is not a positive integer, or a price that is 0 or negative, then saving is blocked with a message.
- c. Given I edit a plan's price or duration, then existing memberships keep their original amount and dates, and only new memberships use the new values.
- d. Given I am STAFF, then I can view plans but not create or edit (rules test).

#### US-3.2 Activate / deactivate plans (FR-3)
As an Admin, I want to retire a plan without deleting it, so that history stays intact.
- a. Given I deactivate a plan, then it no longer appears in assign/renew selectors but still shows on existing memberships and reports.
- b. Given I reactivate it, then it is selectable again.
- c. Given a member's previous plan is inactive when I renew, then the renew dialog asks me to pick an active plan.

#### US-3.3 Delete plan only when safe (FR-3)
As an Admin, I want deletion blocked when a plan is in use, so that history is never orphaned.
- a. Given no membership references the plan, when I delete and confirm, then it is removed.
- b. Given any membership references it (including memberships of soft-deleted members), then delete is refused with a message suggesting deactivation.
- c. Given a membership is created for the plan at the same moment as a delete, then the outcome never leaves a membership pointing at a deleted plan (safe-delete check must be reliable, or a soft-delete of plans is used; architect to decide).

#### US-3.4 Calculate status and days remaining (FR-4, AC-1 to AC-4)
As an Admin, I want status computed correctly and consistently, so that I can trust every screen.
- a. Given today = 19/09/2026 and end dates 27/09, 26/09, 19/09, 18/09, then results are ACTIVE (8), EXPIRING_SOON (7), EXPIRING_SOON (0), EXPIRED (-1) respectively.
- b. Given a suspended member, then status is SUSPENDED for any end date, and daysRemaining is still returned.
- c. Given the clock is 23:59:59 IST on 19/09 and then 00:00:00 IST on 20/09 (= 18:30:00 UTC on 19/09), then an end date of 19/09 changes from EXPIRING_SOON (0) to EXPIRED (-1) at that instant.
- d. Given the device timezone is UTC or America/Los_Angeles, then results are identical to IST results for the same instant.
- e. Given end date before start date, then the function rejects the input.
- f. Given a member with several memberships, then status/daysRemaining use the latest end date (D-5), and no status field is written to the database by viewing or listing.
- g. Given a unit-test matrix over the rows above, then all pass; every screen (list, profile, dashboard, expiring/expired, reports) uses this single function/predicate.

#### US-3.5 Assign a plan and create a first membership (FR-5, FR-2)
As an Admin, I want to attach a plan to a member, so that the member has a defined membership period.
- a. Given a member with no membership, plan Quarterly (3 months, 4000), start 01/10/2026, then the membership is created with end 31/12/2026, amount 4000, and the member summary (plan, start, end) is updated in the same atomic write with an audit "membership created" record.
- b. Given the registration form (from Phase 3), then choosing a plan and start date auto-fills the end date and Total Amount read-only (NEW-3/NEW-4), and creates member + membership atomically.
- c. Given a past or future start date, then it is accepted for Admin and the status derives from the end date only (NEW-5; a not-yet-started membership is labelled "Starts DD/MM/YYYY").
- d. Given an inactive plan, then it cannot be chosen.
- e. Given the month-end examples in FR-5, then computed end dates match the table (unit tests).

#### US-3.6 Renew a membership (FR-5, AC-5, AC-6)
As an Admin, I want to renew a member, so that they keep training without losing history.
- a. Given a membership ending 30/09/2026 and renewal of 1 month on 25/09/2026, then the new membership runs 01/10/2026 to 31/10/2026 and the old record is unchanged.
- b. Given a membership expired on 30/09/2026 and renewal on 10/10/2026, then the new membership starts 10/10/2026.
- c. Given a membership ending today (19/09), when renewed today, then it counts as not expired and the new start is 20/09.
- d. Given a membership that ended yesterday, when renewed today, then the new start is today.
- e. Given the member already has a future-dated renewal ending 31/10, when I renew again, then the new start is 01/11.
- f. Given the renew dialog was opened before midnight and submitted after, then start/end are recalculated at submit time and the admin sees the final dates on the success message.
- g. Given a soft-deleted member, then Renew is unavailable. Given a SUSPENDED member, then behaviour follows NEW-7.
- h. Given a successful renewal, then an audit "membership renewed" record exists, and the member appears in or leaves Expiring/Expired lists accordingly.

#### US-3.7 Renewal integrity and concurrency (FR-5)
As the owner, I want renewals to be safe, so that no period is duplicated or overlapped.
- a. Given two admins renew the same member at the same moment, then the second computes its start from the first one's new end date (or fails with a "member changed, please retry" message); overlapping periods never result.
- b. Given a double-click or a retry after a timeout where the first attempt actually committed, then only one membership is created.
- c. Given renewal with an initial payment, then membership, payment, member summary and audit all commit together or not at all.

#### US-3.8 Members list filters and sort (FR-8, AC-13)
As an Admin, I want to filter by status, plan and expiry date, so that I can target follow-ups.
- a. Given filter Status = Expiring Soon, then the list shows exactly the members counted by the dashboard Expiring card (same predicate).
- b. Given Plan = Monthly plus Status = Expired, then only members whose latest membership is on Monthly and expired are shown.
- c. Given an expiry date range, then only members whose latest end date is in the range (inclusive) are shown.
- d. Given Sort by expiry ascending/descending, then the order is by end date.
- e. Given a filter/search/sort combination that is not supported by the indexes, then it is disabled or explained, never applied to only the current page.
- f. Given SUSPENDED members, then they appear only under the Suspended filter, not under Active/Expiring/Expired.

#### US-3.9 Memberships Expiring Soon page (FR-8, AC-17)
As an Admin, I want a list of memberships about to lapse, so that I can chase renewals.
- a. Given today = 19/09/2026 and window 7, then members with end dates 19/09 to 26/09 inclusive are listed and 27/09 is not.
- b. Given window 1, then end dates 19/09 and 20/09 are listed. Given windows 3 and 15, then end dates up to 22/09 and 04/10 respectively.
- c. Given a member whose current membership ends in 3 days but who already renewed (later end date), then they are not listed.
- d. Given the list, then each row shows name, mobile, plan, expiry date, days remaining, pending amount and a Renew button; suspended members are excluded.
- e. Given many results, then the page is paginated and sorted by days remaining ascending; no results shows an empty state.
- f. Given the default window on first load, then it is 7.

#### US-3.10 Expired Members page (FR-8)
As an Admin, I want to see who has lapsed, so that I can win them back.
- a. Given a member whose latest end date is 18/09/2026 and today is 19/09/2026, then they appear with "1 day since expiry".
- b. Given a member with end date today, then they are not listed (still valid today).
- c. Given a member whose old membership expired but who has a newer current one, then they are not listed.
- d. Given each row, then it shows member, mobile, previous plan, expired date, days since expiry, previous amount and Renew; the list is paginated and most recent expiry first.

#### US-3.11 Suspend and reactivate (FR-8, FR-13, resolved Q3)
As an Admin, I want to suspend a member, so that they are flagged as not entitled to attend.
- a. Given I click Suspend and confirm (reason optional, NEW-7), then the status becomes SUSPENDED regardless of dates, the expiry date is not changed (flag only), and an audit "membership suspended" record is written.
- b. Given a suspended member, when I click Reactivate, then the status is again computed from dates (it may immediately be EXPIRED), and an audit "reactivated" record is written.
- c. Given a suspended member, then they are excluded from Active/Expiring/Expired counts and lists and counted under Suspended.
- d. Given I am STAFF, then Suspend/Reactivate are hidden and denied by rules.

#### US-3.12 Dashboard, status slice (FR-9, AC-16)
As an Admin, I want status cards, an expiring table and a plan chart, so that I see membership health at a glance.
- a. Given the data, then Active, Expiring ≤7d, Expired (and Suspended) cards equal the counts of the members-list filters, and Total equals their sum plus members without a membership.
- b. Given the table "Memberships Expiring Soon", then it shows up to 10 members with the nearest end date in 0-7 days, ascending, using a limited query.
- c. Given the dashboard loads, then no full collection read happens (verified by counting reads in the emulator/test).
- d. Given the plan distribution chart, then it counts members with ACTIVE or EXPIRING_SOON current membership per plan (NEW-19).
- e. Given the page is left open past 00:00 IST, then a refresh recomputes "today" and updates the counts.

#### US-3.13 Profile: membership section, history and status badge (FR-2, FR-4)
As an Admin, I want the profile to show the membership clearly, so that I can answer questions at the desk.
- a. Given a member, then a prominent badge shows ACTIVE / EXPIRING SOON / EXPIRED / SUSPENDED with start date, expiry date and days remaining (or "Expired N days ago").
- b. Given several memberships, then Membership History lists all of them (plan, period, amount, paid, outstanding) newest first, and none is editable.
- c. Given a future-dated membership, then it is shown as "Starts on DD/MM/YYYY".

#### US-3.14 Audit for membership events (FR-13)
As the owner, I want membership changes recorded, so that I can trace disputes.
- a. Given membership created, renewed, suspended or reactivated, then a corresponding append-only audit record exists with plan, period and amount in metadata.

---

### Phase 4 (Payments, History, Pending, Revenue)

#### US-4.1 Record a payment (FR-6, AC-8)
As an Admin, I want to record money received, so that balances stay accurate.
- a. Given a membership with total 1500 and existing payments 500 and 700 (outstanding 300), when I record 300, then outstanding becomes 0 and the state is PAID.
- b. Given outstanding 300, when I record 301, then it is rejected with "Amount exceeds pending balance (300)".
- c. Given amount 0, negative, non-numeric, or with more than 2 decimals, then it is rejected.
- d. Given payment date in the future, then it is rejected; today or past is accepted (NEW-5).
- e. Given method Cash, UPI, Card, Bank Transfer or Other, then it is stored with the optional reference and notes; no card number or CVV field exists.
- f. Given the payment is saved, then the payment, the membership's denormalized paid/outstanding, the member's pending total and an audit "payment created" record commit atomically, and `createdBy` is the logged-in user.
- g. Given two admins record payments totalling more than outstanding at the same time, then at most the amount up to outstanding succeeds and the other fails with a clear message.
- h. Given a double-click or timeout retry, then only one payment is created.
- i. Given the member has multiple memberships with outstanding balances, then I choose which membership (default oldest with outstanding); a payment can never be split or auto-allocated (NEW-10).
- j. Given I am STAFF or a MEMBER, then creating a payment is denied by rules.

#### US-4.2 Payment on registration/renewal forms (FR-2, FR-5, FR-6)
As an Admin, I want to take the first payment while registering or renewing, so that I do it in one step.
- a. Given total 4000 (plan price) and Amount Paid 1500, then the Pending Amount displays 2500, read-only, and updates as I type.
- b. Given Amount Paid = 0, then no payment record is created, payment date/mode/reference are not required, and the membership has outstanding 4000 (UNPAID).
- c. Given Amount Paid > 0, then Payment Mode is required and one payment of that amount is created against the new membership atomically with the membership.
- d. Given Amount Paid greater than Total Amount, then submission is blocked.
- e. Given Amount Paid equals Total Amount, then the state is PAID with outstanding 0.
- f. Given the member later pays the rest, then that goes through US-4.1 against the same membership, and the form's values are never treated as a stored source of truth.
- g. Given I am STAFF registering a member, then the payment section is not shown and the membership starts UNPAID (derived from Q10; NEW-11).

#### US-4.3 Balance calculation across memberships (FR-6, D-7)
As an Admin, I want totals to be right per membership and per member, so that nobody is over- or under-charged.
- a. Given member M with membership A (1500, paid 1500) and membership B (2000, paid 500), then A is PAID with outstanding 0, B is PARTIAL with outstanding 1500, and M's Amount Pending is 1500.
- b. Given a payment for B of 1500, then B is PAID and M's pending is 0; A is unaffected.
- c. Given an old expired membership with unpaid dues and a new paid membership, then M's pending still includes the old dues (NEW-10).
- d. Given amounts like 0.1 and 0.2, then the sum is exactly 0.30 (unit test).
- e. Given a plan price is later changed, then existing memberships' totals and outstanding do not change.

#### US-4.4 Payment history (FR-2, FR-6)
As an Admin, I want a member's payment history, so that I can show past receipts.
- a. Given a member's profile, then Payment History lists every payment (date, amount, method, reference, membership, created by), newest first, paginated.
- b. Given a payment, then it has no edit or delete control (immutable, subject to NEW-9).
- c. Given the sidebar Payments page, then it lists payments across members, paginated, filterable by date range and method.

#### US-4.5 Pending payments (FR-6, FR-9)
As an Admin, I want a list of who owes money, so that I can collect it.
- a. Given members with outstanding > 0, then the Members list shows each member's Amount Pending, and the pending list/report lists them with the amounts, largest or oldest first (paginated, server-side).
- b. Given members with outstanding = 0, then they are not listed as pending.
- c. Given the Pending Payments dashboard card, then it shows total outstanding (INR) and number of members owing, using aggregation/counters, not loading all memberships.
- d. Given a soft-deleted member with dues, then the dues are excluded from the dashboard and lists (warned at deletion, NEW-24).

#### US-4.6 Revenue (FR-9)
As an Admin, I want revenue figures, so that I can see how the gym is doing.
- a. Given payments dated 01/09/2026 00:30 IST (= 31/08/2026 19:00 UTC) and 31/08/2026 23:30 IST, then the first counts in September and the second in August.
- b. Given the Current-month Revenue card, then it sums payments with a payment date in the current IST month (cash basis; membership totals or unpaid amounts are not revenue).
- c. Given the revenue chart, then it shows per-month sums for the last 12 months using aggregation/counters, and voided payments are excluded (if NEW-9).
- d. Given a deleted member's payments, then they are still included.

#### US-4.7 Payment corrections (NEW-9)
As an Admin, I want to correct a mistaken payment without losing history, so that the books stay honest.
- (Default under NEW-9) a. Given a wrong payment, when I void it with a reason, then it is flagged void (not deleted), excluded from totals, the membership outstanding is restored atomically, and an audit record is written.
- b. Given a void payment, then it still shows in history marked VOID and cannot be un-voided or edited.
- c. Given STAFF, then void is denied.

#### US-4.8 Audit for payments (FR-13)
- a. Given payment created (and voided), then append-only audit records exist with membership ID, amount and method in metadata, and never any card data.

---

### Phase 5 (Attendance)

#### US-5.1 Check-in (FR-7, resolved Q9)
As Staff/Admin, I want to check a member in, so that visits are recorded.
- a. Given I search a member by name/mobile/ID prefix and click Check-in, then a record is created for today (IST) with status PRESENT and check-in time now, and the member's name snapshot.
- b. Given the member already has a record today, then a second check-in is refused ("already checked in at HH:MM"); no duplicate is created even with two staff clicking at once.
- c. Given the member is EXPIRING_SOON, then the days remaining are shown at check-in; given EXPIRED or SUSPENDED, then the behaviour follows NEW-12 (default: EXPIRED warns and needs confirmation, SUSPENDED is blocked).
- d. Given a soft-deleted member, then they cannot be found or checked in.
- e. Given the check-in happens at 00:10 IST, then it is dated by the IST day, not UTC.

#### US-5.2 Check-out (FR-7)
- a. Given a member checked in today with no check-out, when I check out, then the check-out time is set and must be after the check-in time.
- b. Given a member already checked out, then a second check-out is refused.
- c. Given a member checked in yesterday without check-out, then today's check-out button is not offered for yesterday's record; that record keeps a blank check-out, shown in history as "not recorded" (NEW-13).

#### US-5.3 Mark absent (FR-7)
- a. Given an admin marks a member ABSENT for today, then a record with status ABSENT and no times is created and it is not counted in Today's Attendance.
- b. Given an ABSENT record exists, when the member arrives and is checked in, then the record becomes PRESENT with a check-in time (still one record per day).
- c. Given STAFF, then marking absent is allowed (default: Staff may mark attendance) and editing or deleting a record later is Admin-only (A).

#### US-5.4 Today's attendance list (FR-7)
- a. Given today's records, then a paginated list shows member, ID, check-in, check-out, and a "Checked in" indicator for members with no check-out.
- b. Given no records, then an empty state is shown.
- c. Given the list stays open past midnight, then a refresh switches to the new IST day.

#### US-5.5 Member attendance history (FR-2, FR-7)
- a. Given a member profile, then Attendance History lists records newest first, paginated, with date, status, check-in, check-out.
- b. Given a member with no records, then an empty state is shown.

#### US-5.6 Monthly attendance report (FR-7)
- a. Given a month selection, then a report shows for each member the number of PRESENT days and the total visits for that IST month, and a month with no records shows an empty state.
- b. Given a record at 23:50 IST on the last day of a month, then it belongs to that month.

#### US-5.7 Dashboard attendance (FR-7, FR-9)
- a. Given today's records, then Today's Attendance = PRESENT records dated today (IST); Currently Checked-in = PRESENT with no check-out today (a member checked in and out counts in the first but not the second).
- b. Given the attendance-by-month chart, then it shows PRESENT record counts for the last 12 IST months via aggregation queries.
- c. Given a member who forgot to check out yesterday, then they are not in today's Currently Checked-in count.

---

### Phase 6 (Reports, CSV)

#### US-6.1 Reports with date filters (FR-10, NEW-20)
As an Admin, I want six reports, so that I can review the business.
Date filter meaning (assumptions): Member report = joining date range; Expired = end date within range (all before today); Expiring = end date within range (today or later); Revenue = payment date range (with totals per day/month and per method); Attendance = attendance date range; Pending payments = membership start date range.
- a. Given a date range, then each report returns only rows within it, using server-side queries and pagination, and shows totals where relevant.
- b. Given end date before start date in the filter, then it is rejected.
- c. Given a range that is empty, then an empty state is shown.
- d. Given the range boundaries, then start and end dates are inclusive whole IST days.
- e. Given Expired and Expiring reports, then they use the same predicates as the pages and the dashboard (US-3.9, US-3.10).

#### US-6.2 CSV export (FR-10)
- a. Given a report on screen, when I click Export, then a CSV with the same filters and columns downloads, dates as DD/MM/YYYY, amounts as numbers.
- b. Given a name such as `=HYPERLINK(...)` or one starting with `+`, `-`, `@`, then it is neutralized so a spreadsheet does not execute it.
- c. Given non-Latin names, then they display correctly when opened in Excel.
- d. Given a very large result, then data is fetched in pages with progress and a warning or cap, and never as one unbounded read.
- e. Given the export, then medical notes are never included.
- f. Given an export failure, then a friendly error appears and no partial file is offered as complete.

#### US-6.3 Report access (FR-10)
- a. Given I am STAFF, then Reports and export are hidden and denied (A, NEW-11).

---

### Phase 7 (Notifications architecture; scheduled processing deferred)

#### US-7.1 Notification service abstraction (FR-11)
As the developer, I want a channel-agnostic interface, so that WhatsApp/SMS/email/push can be added later without changing screens.
- a. Given the `notificationService` interface, then a screen depends only on the interface and a stub implementation, and no external provider SDK or secret is in the project.
- b. Given the stub is called, then it records/logs the intended notification (type, member, channel, message) and reports "not delivered (stub)", never a false success.

#### US-7.2 Notification record type (FR-11)
- a. Given a notification record, then it has member, type (e.g. EXPIRY_REMINDER), channel, status, created-at and payload, and contains no medical data.
- b. Given the default in NEW-21, then no UI creates records in the MVP.

#### US-7.3 Scheduled expiry processing: DEFERRED (FR-12, AC-18)
- Not built. Documented in the README as a future Render Cron Job + Admin SDK option. Status remains dynamic.

---

### Phase 8 (Testing, Security review, Performance, Production deploy)

#### US-8.1 Automated business-logic tests (NFR-6)
- a. Given the test suite, then it covers the status boundary matrix (US-3.4), renewal rules and month-end table (US-3.5/3.6), payment balance and multi-membership cases (US-4.3), validation rules, attendance day boundary, and CSV neutralization.
- b. Given the suite runs in CI or locally with one command, then it passes with no network access.

#### US-8.2 Security review with rules tests (FR-1, AC-10 to AC-12)
- a. Given the emulator, then there is a passing test for each row of the Permission Matrix (allowed and denied cases), including: unauthenticated denial, role forgery, Staff denied medical notes and payment writes, Member reading only own docs, Member denied writing payments and expiry dates, audit records create-only.
- b. Given a user whose `users` doc is missing or has an unknown role, then all app data access is denied.
- c. Given the repository, then no secrets or service-account keys are committed and `.env` is ignored.

#### US-8.3 Performance and indexes (NFR-3, NFR-9, AC-13, AC-16)
- a. Given a seed of 10k+ members, then Members list, Expiring, Expired, dashboard and reports each load one page or bounded aggregates, with the document-read count recorded and within an agreed budget.
- b. Given every query used, then a required composite index is declared in `firestore.indexes.json` and documented, and unsupported filter/sort/search combinations are listed.

#### US-8.4 Seed data (FR-14)
- a. Given the seed is run against a dev/emulator project, then 5 members, 3 plans, 10 payments and attendance exist, covering ACTIVE, EXPIRING_SOON (exactly 7 days and today), EXPIRED, SUSPENDED, a partial payment and a member with 2 memberships.
- b. Given the seed, then it is refused against a production project id, and totals/IDs obey the same invariants as the app.

#### US-8.5 Documentation (FR-14)
- a. Given the README, then all 15 sections exist adapted to the resolved stack (see FR-14), a new developer can bootstrap the first admin and run the app following only the README.

#### US-8.6 Production deployment on Render (NFR-7, NFR-8)
- a. Given the Render static site, then refreshing a deep link (e.g. `/members/GYM-2026-0001`) loads the app (SPA rewrite), env vars are set in Render, and the Render domain is in Firebase Auth authorized domains.
- b. Given production rules and indexes are deployed, then login, one registration and one dashboard load work against production.
- c. Given a production checklist, then it covers rules deployed, indexes deployed, admin bootstrapped, seed NOT run, backups/export approach for Firestore noted.

---

## Traceability Matrix (FR to stories)

| FR | Stories |
|---|---|
| FR-1 Auth & RBAC | US-1.1 to US-1.6, US-1.9, US-8.2 |
| FR-2 Registration & profile | US-2.1 to US-2.7, US-2.9, US-2.10, US-3.5, US-3.13, US-4.2, US-4.4, US-5.5 |
| FR-3 Plans | US-3.1 to US-3.3 |
| FR-4 Status & expiry | US-3.4, US-3.13 |
| FR-5 Renewal / assignment | US-3.5 to US-3.7, US-4.2 |
| FR-6 Payments | US-4.1 to US-4.8 |
| FR-7 Attendance | US-5.1 to US-5.7 |
| FR-8 Lists / Expiring / Expired | US-2.8, US-2.11, US-3.8 to US-3.11 |
| FR-9 Dashboard | US-2.12, US-3.12, US-4.5, US-4.6, US-5.7 |
| FR-10 Reports | US-6.1 to US-6.3 |
| FR-11 Notifications | US-7.1, US-7.2 |
| FR-12 Cloud Functions | Deferred (US-7.3) |
| FR-13 Audit | US-2.14, US-3.11, US-3.14, US-4.8 |
| FR-14 Seed & docs | US-8.4, US-8.5 (+ Phase 1 minimal README) |
| FR-15 Trainers & Settings | US-2.13 (Settings: placeholder only) |
| FR-16 Privacy & consent | US-2.6, US-2.7 |
| FR-17 App shell & UX | US-1.7, US-1.10 |
| NFR-6/7/8/9 | US-1.8, US-8.1, US-8.3, US-8.6 |

---

## Validation Findings (this pass)

Contradictions and how each was handled:
1. **FR-5 said the renewal "starts at the existing end date"**, but AC-5 (30/09 to 01/10) means end date + 1. Fixed to end date + 1 day.
2. **EXPIRING_SOON boundary** was ambiguous ("within the next 7 days"). Fixed by D-2 to D-4: end date = today is EXPIRING_SOON (0 days), exactly 7 days out is EXPIRING_SOON, 8 days is ACTIVE, end date yesterday is EXPIRED.
3. **Registration form payment fields vs `payments`** (Total / Paid / Pending stored twice would drift). Fixed by D-7: payments are the source of truth, Pending is display-only.
4. **Source stores `status` on member/membership**, but status is dynamic (resolved Q1c). Only the suspended flag is stored; the form's Membership Status is display-only.
5. **Source Phase 2 registration needs plans that arrive in Phase 3** (NEW-1).
6. **Staff can register members but cannot record payments (Q10)** so the registration payment section is hidden for Staff (NEW-11).
7. **FR-2 and AC-14 said "store the URL"** and AC-10/Affected Files mentioned Storage; **FR-12 relied on callable functions** for ID allocation/role assignment. All aligned to the resolved decisions (`memberPhotos` doc, client transaction, `users` doc, no Functions, AC-18 parked).
8. **README sections 8, 11, 14** assume Storage, Firebase Hosting and Functions, adapted (FR-14).
9. **Expiring window of 15 days vs the 7-day EXPIRING_SOON status**: rows in the 8-15 day range are listed but keep an ACTIVE badge (documented, not a bug).
10. **Resolved Q1 text says "Sub-questions 1a-1c are still open"** while the header says all resolved: stale sentence (a bracketed note was added; no decision changed).
11. **`docs/domain-context.md` still lists Storage, Cloud Functions, Firebase Hosting and a scheduled-function System actor** in Stack/Key Actors. Not edited here; recommend updating so downstream agents are not misled.

Gaps found and addressed: no FR for the app shell (FR-17), Trainers/Settings/Payments-menu phases (FR-15, NEW-2), reactivation missing as inverse of Suspend, current-membership definition for multi-membership members (D-5), status counts not partitioning (FR-4), payments across several memberships (D-7, NEW-10), payment correction path (NEW-9), required-field list absent (matrix, NEW-15), Staff vs Admin permissions per module (matrix), search semantics vs Firestore limits (FR-8), dashboard query budget (FR-9), "currently checked-in" definition (FR-7), audit atomicity and limits (FR-13), CSV injection (FR-10), consent capture (FR-16), seed mechanism safety (FR-14), no Phase 1 behaviour for non-admin logins (US-1.6).

---

## Resolved Decisions (unchanged, 2026-09-19)

**ALL RESOLVED on 2026-09-19: the user accepted every proposed default (bold) below, including 1a–1c.** Where Q1 conflicts with `requirment.md` (Firebase Hosting / Storage / Cloud Functions), this file wins: Firestore + Auth only, hosted on Render. FR-12 (Cloud Functions) is deferred and FR-2 photos use a Firestore doc instead of Storage.

1. **RESOLVED (user, 2026-09-19): Firebase is used for the Firestore database only. The app is deployed on Render, not Firebase Hosting.** This overrides the source `requirment.md` where it lists Firebase Hosting, Storage and Cloud Functions. Sub-questions 1a–1c below are still open. *[Editor's note: 1a-1c were subsequently resolved with the defaults below, per the header of this section.]*
   - **1a. Authentication:** Keep Firebase Authentication (free on the Spark plan, needed for Firestore security rules)? **Default: yes, Auth stays.**
   - **1b. Profile photos:** Firebase Storage needs the paid Blaze plan for new projects. **Default: store a small compressed image (max ~100 KB, validated type) as a Firestore field in a separate `memberPhotos/{memberId}` doc, so no Storage is needed. Alternative: drop photos from the MVP.**
   - **1c. Scheduled expiry/notifications:** Cloud Functions also need Blaze. **Default: no Cloud Functions in the MVP. Status is computed dynamically, and the Expiring/Expired pages, dashboard and reports query by `endDate`. The notification service abstraction stays with a stub. A Render Cron Job (paid) using the Admin SDK is a later option.**
   - Consequences of "Firestore only" (no Functions): Member ID counter uses a client-side Firestore transaction; role comes from a server-controlled `users/{uid}` doc (no custom claims, since those need the Admin SDK); admin bootstrap is done manually in the Firebase console (documented in the README).
2. **Month arithmetic:** Your example (01 Sep → 30 Sep, then 01 Oct → 31 Oct) means the end date is the *last inclusive day* of the calendar month. **Default: calendar-month plans (start + N months − 1 day), inclusive end date; day-based plans use start + N − 1 days.**
3. **Suspension:** Does suspending pause the clock (extend expiry on resume) or just flag the member? **Default: flag only; no expiry extension in the MVP.**
4. **Member login:** Do members log in with the email on their profile? **Default: MVP has no member login UI. Admin later creates the Auth account and links the uid to the member doc.**
5. **Member ID year:** Does the counter reset each year (`GYM-2027-0001`)? **Default: yes, per-year counter.**
6. **Delete member:** **Default: soft-delete (hidden, audit + payments retained). Hard delete is not offered.**
7. **Single gym or multi-tenant?** **Default: single gym; no tenant field.**
8. **Overpayment:** **Default: rejected; payment cannot exceed outstanding.**
9. **Attendance model:** One check-in/out record per member per day? **Default: yes; ABSENT is explicit, only if the admin marks it.**
10. **Staff scope (future):** Can Staff record payments? **Default: no, Admin only; Staff can view membership status and mark attendance.**

---

## Open Questions: NEW (RESOLVED 2026-09-19: user replied "continue" after being offered "accept all defaults or change any"; every proposed default below is adopted, incl. NEW-16 = keep soft-delete for MVP and flag erasure/retention as an owner/legal decision before production)

Each shows a proposed default used by the stories above so work can proceed; the user should confirm or override. "Needed by" is the latest phase where the answer must be known.

| ID | Question | Proposed default (used in the stories) | Needed by |
|---|---|---|---|
| NEW-1 | Phase 2 registration cannot assign a plan (plans arrive in Phase 3). Pull plans into Phase 2, or register without a membership first? Which dashboard cards are real in Phase 2? | Phase 2 registers a member with no membership; Phase 3 adds Plan/Start/End to the same form and "Assign plan" for existing members; Phase 2 dashboard has only Total Members and New-members chart real, other cards show "-". | Phase 2 start |
| NEW-2 | Trainers module and Settings page have no requirements or phase. What does each contain? | Trainers: Admin CRUD (name, mobile, active), used as a dropdown, delivered in Phase 2. Settings: placeholder only in the MVP. | Phase 2 |
| NEW-3 | Is Total Amount always the plan price (read-only), or can Admin discount/override it? | Read-only plan price snapshot; discounts out of MVP. | Phase 3 |
| NEW-4 | Can Admin override the auto-calculated end date (e.g. promotions)? | No; end date is auto-calculated and read-only. | Phase 3 |
| NEW-5 | Are past/future membership start dates and back-dated payments allowed? Does a membership that has not started yet show a special status? | Admin may pick any start date (onboarding existing members); status derives from end date only, labelled "Starts DD/MM/YYYY". Payment date may be today or past, never future. | Phase 3 |
| NEW-6 | Month-end anchor: 31/01 + 1 month yields 27/02 under the resolved rule (28-31 Jan all end 27/02); chained renewals then drift to the 28th. Acceptable? | Yes, literal resolved rule (table in FR-5), with unit tests. | Phase 3 |
| NEW-7 | Can a SUSPENDED member be renewed or paid for? Is a suspension reason required? | Reactivate action exists (Admin). Renewal is blocked while suspended until reactivated; payments are still allowed; suspension reason optional free text. | Phase 3 |
| NEW-8 | Is suspension per member or per membership? | Per member (flag on the member). | Phase 3 |
| NEW-9 | How does an Admin correct a wrong payment? | Payments immutable; Admin can void with reason (excluded from totals, audited). | Phase 4 |
| NEW-10 | With several memberships: must the admin pick which one a payment applies to; do old unpaid dues carry forward in the member's "Amount Pending"? | Explicit selection, no auto-allocation, overpayment checked per membership; dues carry forward. | Phase 4 |
| NEW-11 | Confirm every `A` row in the Permission Matrix (Staff cannot edit members/renew/see payments/reports; Staff sees pending amount read-only; Staff registration has no payment section; Staff dashboard non-financial only). | As marked in the matrix. | Phase 2 (registration/edit), each later phase |
| NEW-12 | May EXPIRED or SUSPENDED members be checked in? | EXPIRED: warning + explicit confirm; SUSPENDED: blocked. | Phase 5 |
| NEW-13 | Attendance day boundary: gyms open past midnight; back-dating; forgotten check-outs. | Attendance day = IST day of check-in; check-out same day only; missing check-out stays blank ("not recorded"); back-dating Admin-only. | Phase 5 |
| NEW-14 | Duplicate mobile: hard block or warn? Only Indian 10-digit mobiles? | Warn with explicit confirm (families share phones); Indian mobiles only. | Phase 2 |
| NEW-15 | Confirm the Field validation matrix (which fields are required, under-18 guardian rule, gender options, note length, photo limits, when a reference is required for non-cash payments). | As in the matrix; reference optional for all modes. | Phase 2 |
| NEW-16 | DPDP: soft-delete only does not fulfil an erasure request. What retention period, and is there a manual anonymization procedure (strip PII, keep payments)? Consent wording (needs legal review)? Restore of a deleted member? | Document a manual anonymization procedure in the README; retention period TBD by owner; no restore in MVP. | Phase 2 (consent), Phase 8 |
| NEW-17 | Who creates Staff/Member Auth accounts and `users` docs? Client SDK sign-up would sign the admin out, and there is no Admin SDK. | Firebase console only in the MVP; no user-management UI. | Phase 1 (documentation) |
| NEW-18 | Session policy: idle timeout / forced re-login? | Firebase default persistent session, no idle timeout in the MVP. | Phase 1 |
| NEW-19 | Dashboard definitions: Pending Payments card (amount, count or both), plan-distribution basis, table window, chart range, Suspended count shown? | Total outstanding INR + count of members owing; ACTIVE+EXPIRING_SOON members per plan; next 10 within 0-7 days; last 12 months; Suspended shown as a secondary card. | Phase 3/4 |
| NEW-20 | Report date-filter semantics per report, who may export, and should exports be audit-logged (bulk PII)? | As in US-6.1; Admin only; export logged in audit. | Phase 6 |
| NEW-21 | Should Phase 7 include any UI action that creates notification records (e.g. a manual "log reminder" on the Expiring page)? | No; interface + record type + stub only. | Phase 7 |
| NEW-22 | Is an audit-log viewer page wanted in the MVP, and which extra events (reactivated, void, export)? | No viewer (read in Firebase console); extra events recorded. | Phase 2 |
| NEW-23 | Confirm photo limits: accepted types, 5 MB input, about 100 KB output. Should photos appear in list rows (extra reads per row)? | JPEG/PNG/WebP, 5 MB, 100 KB; photo only on profile and check-in, not list rows. | Phase 2 |
| NEW-24 | Deleting a member who has outstanding dues or an active membership: block or warn? | Warn and allow with confirm. | Phase 2/4 |
| NEW-25 | Name search: which name forms should match by prefix (first, last, "first last")? Default sort and page size of the members list? | First, last or full-name prefix; page size 25; default order newest registered first. | Phase 2 |
| NEW-26 | Does Phase 1 need a real first deploy to Render, or documented-only? | Documented only; first deploy optional. | Phase 1 |

---

## Risks (summary)
- **R-1 Client-trust limits:** no Functions/Admin SDK means member ID allocation, audit writes, denormalized totals and role checks all run from the client and depend on Firestore rules and transactions. A hostile Admin/Staff client could skip audit records; rules can only partially prevent it.
- **R-2 Denormalization drift:** member/membership summaries (latest end date, pending, plan) power lists and dashboard counts. They must be written atomically with every renew/payment/void/suspend, or counts diverge from history.
- **R-3 Client clock and timezone:** "today" is computed on the device. A wrong device clock gives wrong statuses, IDs by year, and payment dates. Rules can use server time for writes, but display logic cannot fully avoid this.
- **R-4 Firestore query limits:** search + status + plan + expiry + sort cannot all be combined in one query, and composite-index count grows. The supported combinations must be agreed and documented.
- **R-5 Quota on the free plan:** daily read/write limits (verify current values) make dashboard and list read budgets a functional concern.
- **R-6 Compliance:** medical data separation, minors' consent, and erasure vs soft-delete need owner and legal input (NEW-16).
- **R-7 Seed and bootstrap safety:** seeding without an Admin SDK or running seed against production could corrupt real data.
- **R-8 Photos in Firestore:** the 1 MiB document limit and read costs constrain photo size; hence the separate doc and 100 KB cap.
- **R-9 Phase sequencing:** Phase 2 dashboard/registration depend on later-phase data unless NEW-1 is decided.
