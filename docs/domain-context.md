# Domain Context: Gym / Fitness Management (SaaS)

> Custom domain — verify these assumptions with the user.

**Project type:** NEW (no existing code as of 2026-09-19)
**Source requirements:** `requirment.md`
**Stack:** React 18 + TypeScript + Vite + MUI + React Router, Firebase (**Firestore + Authentication only**), deployed on **Render** as a static site. No Firebase Storage, Cloud Functions or Firebase Hosting (user decision 2026-09-19; they need the paid Blaze plan). No separate Java/Spring backend. There is no server component, so rules and Firestore transactions are the only enforcement layer.
**Locale:** India — timezone `Asia/Kolkata`, dates shown as `DD/MM/YYYY`, currency INR, payment modes incl. UPI.

## Key Actors
- **Admin / Gym owner** — full access: members, plans, payments, reports, attendance, audit log (MVP focus)
- **Staff** — view/register members, mark attendance, view membership status; limited admin access
- **Member** — read-only access to own profile, membership, expiry, payments, attendance
- **Trainer** — assigned to members (a record, not necessarily a login role)
- **System (deferred)** — scheduled expiry processing / notifications are out of the MVP; status is computed dynamically. A Render Cron Job is a possible later option.

## Core Flows
- Auth: email/password login, logout, forgot password, protected routes, role-based access
- Member registration with server-safe auto ID (`GYM-YYYY-NNNN`), profile photo upload
- Membership plans CRUD (activate/deactivate, delete only when safe)
- Assign plan to member; track start/end dates
- Membership status: ACTIVE (>7 days left), EXPIRING_SOON (≤7 days), EXPIRED (end date before today), SUSPENDED (manual)
- Renewal: extend from existing end date if still valid; start from today if expired; every renewal is a new membership + payment record (history never overwritten)
- Payments: full / partial / pending, with automatic total / paid / outstanding
- Attendance: check-in / check-out, today's attendance, per-member history, monthly report
- Dashboard: KPI cards, charts (new members, revenue, attendance, plan distribution), next 10 expiring memberships
- Reports with date filters and CSV export
- Audit log of key actions
- Notification service abstraction (WhatsApp/SMS/email/push later, no provider in MVP)

## Regulatory / Compliance
- **India DPDP Act 2023** — members' personal data (mobile, address, DOB, emergency contact) needs purpose limitation, consent, and deletion/retention rules
- **Medical notes are sensitive health-related data** — restrict to Admin (and Staff only if the user decides); never expose to other members
- **Members are possibly minors (DOB captured)** — flag consent handling for under-18 members
- **GST on membership fees** — confirm with the user whether invoices/GST are in scope (not in current requirements)
- **PCI-DSS** — avoid it by never storing card data; record only mode and transaction reference
- Firebase best practice: no Admin SDK credentials or secrets in the client; `.env` not committed, `.env.example` provided

## High-Risk Areas
- **Timezone/date bugs** in expiry calculation — days remaining must be computed on Asia/Kolkata calendar days, not raw UTC millisecond differences
- **Renewal logic** — extend vs restart rule, and month-end arithmetic (e.g. 1 month from 31 Jan)
- **Duplicate Member IDs** — generate with a Firestore transaction / counter document, never client-side only
- **Payment integrity** — partial payments, outstanding balance drift, and members must not be able to edit payments or expiry dates
- **Denormalized totals** (paid / outstanding) getting out of sync — update atomically in transactions
- **Firestore security rules** — role must come from custom claims or a server-controlled `users` doc, never from client-supplied data; members read only their own data
- **Deleting members/plans** — protect historical memberships, payments and audit trail (prefer soft-delete or safe-delete checks)
- **Firestore query limits** — no full-text search, composite indexes needed, no loading all members; pagination required
- **Unnecessary writes** — prefer computing status dynamically over daily mass status updates; document the tradeoff
- **Profile photo upload** — file type/size validation, compression, failure handling

## Common Non-Functional Concerns
- Desktop-first, mobile-friendly responsive UI (sidebar + top bar, dialogs, toasts, loading/empty/error states)
- Firestore scalability: server-side pagination, prefix search on normalized fields (name, mobile, member ID), documented indexes
- Firestore Timestamps for all important dates (not formatted strings)
- Audit logging for member/membership/payment/suspension/deletion events
- Friendly handling of network loss, permission denied, Firebase unavailable
- Testing focus: expiry status, expiring-soon window, renewal dates, payment balance, validation, role permissions
- Layered code: UI components / Firebase services / business logic / utils / types (no Firebase calls directly in components)
- Runnable at the end of each phase; no unnecessary libraries
