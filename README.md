# Hercules Fitness: Gym Management System

Single-gym management app. React 18 + TypeScript (strict) + Vite + MUI + React Router, backed by
**Firebase Authentication and Cloud Firestore only**, deployed to **Render as a static site**.

There is no server. Firestore security rules and transactions are the only enforcement layer.
Firebase Storage, Cloud Functions, Firebase Hosting and the Admin SDK are deliberately never used.

Locale: India (`Asia/Kolkata`, `DD/MM/YYYY`, INR). Design documents: `docs/requirements`, `docs/architecture`, `docs/domain-context.md`.

**Status: Phase 8 (testing, security review, performance, production deployment) on top of Phases 1 to 7.** The feature set is complete
for the MVP; what remains is the owner's go-live work in [section 15](#15-production-checklist). Only **ADMIN** accounts can enter the app; Staff and
Member accounts are refused and signed out (the rules and screens are already role-aware; enabling Staff is a one-line change in `src/constants/roles.ts`).

## Contents

The 15 numbered sections follow the source spec (`requirment.md`), adapted to the resolved stack (no Storage, no Cloud Functions, no Firebase Hosting):

1. [Project overview](#1-project-overview)
2. [Features](#2-features)
3. [Architecture](#3-architecture)
4. [Prerequisites](#4-prerequisites)
5. [Firebase project creation](#5-firebase-project-creation)
6. [Firebase Authentication setup](#6-firebase-authentication-setup) (incl. the first-admin bootstrap)
7. [Firestore setup](#7-firestore-setup)
8. [Profile photos in Firestore](#8-profile-photos-in-firestore) (replaces "Firebase Storage setup")
9. [Environment variables](#9-environment-variables)
10. [Local development](#10-local-development) (run, emulators, seed, all test commands)
11. [Render deployment plus rules and indexes deployment](#11-render-deployment-plus-rules-and-indexes-deployment) (replaces "Firebase deployment")
12. [Firestore indexes](#12-firestore-indexes) (every index, unsupported combinations, measured read counts)
13. [Security rules](#13-security-rules) (Permission Matrix tests, audit atomicity, limits, known gaps)
14. [Scheduled processing (deferred)](#14-scheduled-processing-deferred) (replaces "Cloud Functions deployment")
15. [Production checklist](#15-production-checklist)

Appendices: [A. Testing](#appendix-a-testing) · [B. Reconcile](#appendix-b-reconcile-read-only-drift-check) · [C. Clock-skew banner](#appendix-c-clock-skew-warning-banner) ·
[D. Erasure and anonymization (DPDP, NEW-16)](#appendix-d-manual-anonymization-procedure-dpdp-new-16) · [E. Project layout](#appendix-e-project-layout) ·
[F. Troubleshooting](#appendix-f-troubleshooting) · [G. Phase-by-phase notes (Phases 2 to 7)](#appendix-g-phase-by-phase-notes-phases-2-to-7)

## 1. Project overview

Hercules Fitness gives a gym owner one web app to register members, sell and renew memberships, take payments, track attendance and see at a
glance who is active, expiring soon or expired. It is Admin-first: the Admin is the only role with a UI in the MVP.

| Actor | MVP | Notes |
|---|---|---|
| Admin (owner) | Full app | Bootstrapped by hand in the Firebase console (section 6). |
| Staff | Architecture-ready, login off | Rules already give Staff the front-desk subset (register, attendance, read members); `APP_ALLOWED_ROLES` in `src/constants/roles.ts` turns the UI on. |
| Member | Architecture-ready, no UI | Rules already limit a Member to their own documents. |
| Trainer | A record, not a login | Assigned to members. |

Fixed decisions (user decisions in `docs/domain-context.md`): Firestore + Auth only; Render static site; no Cloud Functions, no Storage, no Admin SDK;
status is computed, never batch-written; all money is integer paise; all calendar days are `Asia/Kolkata` days stored as 00:00 IST Timestamps.

## 2. Features

- **Auth**: email/password login, logout, forgot password, persistent session, role from `users/{uid}`, protected and role-aware routes, 404.
- **Members**: registration with server-safe ID `GYM-YYYY-NNNN` (per-year counter in the same transaction as the member), duplicate-mobile warning, consent + under-18
  guardian handling, profile photo, Admin-only medical notes, edit with a concurrency guard, soft delete, prefix search (name / mobile / member ID), filters, cursor pagination.
- **Plans and memberships**: plan CRUD with safe delete, assign / renew (extend from the latest end date or restart today; month-end arithmetic), suspend / reactivate, Expiring soon and Expired pages.
- **Payments**: full / partial / unpaid, record against a chosen membership, one-way void, first payment with a new membership, Payments and Pending pages; totals are exact (integer paise) and updated in the same transaction.
- **Attendance**: check-in / check-out / absent (one record per member per IST day), today's list, member history, monthly report.
- **Dashboard**: status cards, plan chart, next-10 expiring, pending payments, revenue this month, monthly charts (new members, revenue, attendance); aggregations only.
- **Reports**: Members, Expired, Expiring, Revenue, Attendance, Pending; date filters; paged CSV export (BOM, formula-neutralized, 5,000-row cap, audited, no medical data).
- **Audit log**: append-only records written in the same commit as the action (and, since Phase 8, *required* by the rules, section 13).
- **Notifications**: a provider-agnostic interface with a stub that delivers nothing (section 14).
- **Operations (Phase 8)**: read-only `reconcile` drift check (Appendix B), device clock-skew banner (Appendix C), seed for local development.

## 3. Architecture

```
React components / pages  ->  hooks  ->  services (the ONLY layer that imports Firebase)  ->  Firestore + Auth
                                  \->  domain (pure, Firebase-free: dates, status, renewal, money, payments, attendance, CSV, query plans)
```

- **Trust model.** No server exists, so a hostile but authenticated client could write rule-valid nonsense. The rules therefore validate identity, role, shape, immutability
  and the cross-document invariants (member ID <-> counter, membership <-> member summary, payment <-> membership paid total <-> member pending total, and audit record <-> write).
  Roles come only from `users/{uid}`, which no client can write.
- **Transactions.** Every write is one `runTransaction` (all reads first) with pre-generated document IDs so retries are idempotent: TX-1 register, TX-2 assign, TX-3 renew, TX-4 record payment,
  TX-5 void, TX-6 suspend, TX-7 soft delete, TX-8 update, TX-9 attendance, TX-10 plans (architecture section 2.7).
- **Status is a date range.** ACTIVE (8+ days), EXPIRING_SOON (0 to 7), EXPIRED, SUSPENDED and NO_MEMBERSHIP are computed from the stored latest end date; the same predicates build the
  list filter, the dashboard counts and the reports, so the numbers always agree.
- **Denormalized totals** (`pendingPaise`, `paidPaise`, member membership summary) are maintained only by the transactions above and are checkable with `npm run reconcile`.
- Full detail: `docs/architecture/gym-management-system-architecture.md`.

## 4. Prerequisites

- Node.js 22 LTS (Node 20.19+ also works for the app; Vite 7 needs 20.19+ or 22.12+) and npm.
- A Google account to create a Firebase project.
- **Java 21+** only to run the Firestore emulator (rules tests, integration tests, seed, perf measurement). The emulator jar is downloaded by `firebase-tools` on first use (about 100 MB, cached in `~/.cache/firebase`).
- A Git repository (Render deploys from Git). This folder is not a git repo yet: run `git init` and push to GitHub/GitLab before creating the Render service.

## 5. Firebase project creation

1. Firebase Console -> **Add project**. Google Analytics is not needed.
2. **Project settings -> General -> Your apps -> Add app -> Web (`</>`)**. Register it (no Firebase Hosting). Copy the `firebaseConfig` values; you need `apiKey`, `authDomain`,
   `projectId`, `messagingSenderId`, `appId` (section 9).
3. Do **not** enable Storage, Functions or Hosting. `VITE_FIREBASE_STORAGE_BUCKET` is intentionally not an env var.
4. Create Authentication (section 6) and the Firestore database (section 7).

## 6. Firebase Authentication setup

1. **Build -> Authentication -> Get started -> Sign-in method -> Email/Password -> Enable** (leave "Email link" off).
2. **Lock down self-registration (required).** The Web API key is public (it ships in the bundle), and Firebase Auth lets anyone holding it call the sign-up endpoint. The app has no sign-up screen,
   and a stranger's account would still be refused by the role check and the Firestore rules, but do not leave the door open:
   - **Authentication -> Settings -> User actions**: **untick "Enable create (sign-up)"**. Accounts can then only be created by an admin in the console.
   - Keep **Email enumeration protection enabled** (same page; on by default for newer projects, but verify it). Do not turn it off.
3. **Authorized domains** (Authentication -> Settings -> Authorized domains): add the Render domain, see [section 11](#11-render-deployment-plus-rules-and-indexes-deployment). `localhost` is already there.

### First-admin bootstrap (manual, one time)

Roles come from a Firestore document that **no client can write** (`users/{uid}`: `allow write: if false`). So the first admin, and every later Staff/Member account, is created by hand in the console.

1. **Authentication -> Users -> Add user.** Enter the owner's email and a strong password. Copy the generated **User UID**.
2. **Firestore Database -> Start collection** (first time) or **+ Add document** in `users`:
   - **Document ID**: paste the UID exactly (do not auto-generate).
   - Fields:

     | Field | Type | Value |
     |---|---|---|
     | `email` | string | the owner's email |
     | `displayName` | string | e.g. `Gym Owner` |
     | `role` | string | `ADMIN` (exactly, uppercase) |
     | `active` | boolean | `true` |
     | `createdAt` | timestamp | now |

3. Open the app and sign in.

Things to know:

- A user who authenticates but has **no** `users/{uid}` document, has `active: false`, has an unknown `role` (roles are compared exactly: `admin`, `ADMIN ` and `SUPERADMIN` all fail), or has role `STAFF`/`MEMBER` (no UI yet)
  sees "You do not have access to this application" and is signed out. The rules deny such a user everything (tested for ten malformed variants, `tests/rules/roles.test.ts`).
- Deleting or breaking the owner's `users` document locks the owner out of the **app** (not out of the Firebase console). Fix it in the console.
- There is no sign-up screen and no user-management UI in the MVP. "Forgot password" sends Firebase's standard reset email and uses Firebase's hosted reset page.

## 7. Firestore setup

1. **Build -> Firestore Database -> Create database**. Choose **production mode** (the repo's rules are deployed in section 11) and a region close to the gym (for India, `asia-south1` Mumbai). The region cannot be changed later.
2. Create the first admin's `users/{uid}` document (section 6). Nothing else needs to be created by hand: every other collection is created by the app on first write.
3. Deploy the rules and indexes ([section 11](#11-render-deployment-plus-rules-and-indexes-deployment)) **before** first use: the app does not work against an empty ruleset (everything is denied) and list screens need their indexes.

| Collection | Doc id | Purpose |
|---|---|---|
| `users` | Auth UID | role source of truth (console-only writes) |
| `members` | auto id (`memberId` field = `GYM-2026-0001`) | profile, search fields, membership summary, `pendingPaise`, consent; **no** medical notes, **no** photo |
| `memberMedical` | = member id | Admin-only medical notes (a separate document because rules cannot hide one field) |
| `memberPhotos` | = member id | one compressed photo as base64 (section 8) |
| `membershipPlans` | auto id | name, duration, price (paise), active |
| `memberships` | auto id | one per assign / renew; period, plan and amount are immutable history; `paidPaise`, `outstandingPaise`, `unpaid` |
| `payments` | auto id, or `<membershipId>_first` | money received; immutable except a one-way void |
| `attendance` | `{memberDocId}_{YYYYMMDD}` | one per member per IST day |
| `trainers` | auto id | name, mobile, active |
| `counters` | `memberId-2026` | member-ID sequence, +1 per registration, never reset |
| `auditLogs` | auto id | append-only; Admin reads in the console (no viewer UI) |

Conventions: money is **integer paise** (`150000` = Rs 1,500; the console shows paise, screens and CSV show rupees); a calendar day is a Timestamp at **00:00 IST** (18:30 UTC the day before); audit metadata holds field
names and non-sensitive facts only (never medical text, a payment reference, notes or a void reason). `notifications` and `settings` are not used and stay denied.

## 8. Profile photos in Firestore

(The source spec's "Firebase Storage setup" does not apply: Storage needs the paid plan and is never used.)

- JPEG / PNG / WebP up to 5 MB is accepted, resized to at most 512 x 512 and re-encoded in the browser to about 100 KB; the canvas re-encode removes EXIF / GPS data.
- The result is stored as a base64 data URL in `memberPhotos/{memberDocId}` (one photo per member), **never** in list rows, so member lists stay cheap and the 1 MiB document limit is never approached.
- The rules cap the document (`bytes <= 102400`, `dataUrl` <= 180,000 characters, only `image/webp` or `image/jpeg`, at most 1024 x 1024). Staff may add a photo (registration or a retry) but not replace one; Admin may replace or delete.
- A failed photo save never blocks registration: the member exists and the profile offers a retry. No photo can be added to a soft-deleted member.

## 9. Environment variables

Copy the template and fill in the values from section 5:

```bash
cp .env.example .env.local
```

| Variable | Required | Notes |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | yes | From the web app config. |
| `VITE_FIREBASE_AUTH_DOMAIN` | yes | Usually `<project-id>.firebaseapp.com`. |
| `VITE_FIREBASE_PROJECT_ID` | yes | |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | yes | |
| `VITE_FIREBASE_APP_ID` | yes | |
| `VITE_USE_EMULATORS` | no | `true` = use the local Auth + Firestore emulators. Refused in production builds. Default `false`. Never set on Render. |
| `VITE_EMULATOR_HOST` | no | Default `127.0.0.1`. |

Notes:

- `.env`, `.env.local` and every `.env.*` file except `.env.example` are git-ignored, and `tests/unit/secrets.test.ts` fails if a key-shaped value appears anywhere else in the tree. Never commit real values.
- Firebase web config values identify the project; they are not secrets. Access is enforced by the Firestore rules and Authentication, not by hiding these values.
- There is **no** service-account key or Admin SDK credential anywhere in this project, and there must never be.
- Vite bakes these values into the bundle at build time. On Render, changing one requires a redeploy.
- If any required value is missing at startup the app shows a "not configured" screen naming the missing keys instead of a blank page.

## 10. Local development

```bash
npm ci            # or: npm install
npm run dev       # http://localhost:5173
```

| Script | What it does | Needs |
|---|---|---|
| `npm run typecheck` | `tsc -b --noEmit` (strict, `noUncheckedIndexedAccess`) | |
| `npm run lint` | ESLint (also enforces "no Firebase imports outside `src/services` and `src/firebase`") | |
| `npm test` | Vitest unit + component tests: business logic, validation, CSV, attendance day boundary, indexes, secrets, seed / reconcile guards. **No network, no emulator.** | |
| `npm run test:rules` | Firestore rules tests (one per Permission-Matrix row and more) + real-transaction integration tests + the rules-budget test | Java 21+ |
| `npm run test:perf` | Read-cost measurement on a 10,500-member dataset (about 2 minutes; `PERF_MEMBERS=21000` for more) | Java 21+ |
| `npm run seed` | Seed the LOCAL emulator with sample data (refuses anything else) | emulator running |
| `npm run reconcile` | Read-only drift check (Appendix B) | emulator, or an Admin login + `--yes` |
| `npm run build` | `tsc -b && vite build` into `dist/` | |
| `npm run preview` | Serve the production build locally | |
| `npm run deploy:rules` | `firebase deploy --only firestore:rules,firestore:indexes` | Firebase login |

### Working against the emulators (optional)

1. In `.env.local` set `VITE_USE_EMULATORS=true` (the five Firebase values may be any non-empty dummy strings, e.g. `demo-key`, `demo-hercules-fitness.firebaseapp.com`, `demo-hercules-fitness`, `0`, `1:0:web:0`).
2. `npx firebase emulators:start --only auth,firestore` (Emulator UI: http://localhost:4000).
3. `npm run seed` in a second terminal (below), or create an Auth user in the UI and its `users/{uid}` document (section 6), then `npm run dev`.

**Emulator data is not persisted.** Stopping the emulators discards every Auth user and Firestore document, so after each restart you must create the Auth user **and** the admin's `users/{uid}` document again (or re-run the seed).
To keep data between runs start with `npx firebase emulators:start --only auth,firestore --import=./firebase-export-local --export-on-exit=./firebase-export-local` (`firebase-export-*/` is git-ignored).
`.firebaserc` ships with the placeholder project `demo-hercules-fitness`; the `demo-` prefix guarantees the emulator can never touch a real project. Replace it with your real project id before deploying (section 11).

### Seed data (local emulator only)

```bash
npx firebase emulators:start --only auth,firestore     # terminal 1
npm run seed                                           # terminal 2
```

The seed creates 12 members, 3 trainers, **3 plans**, memberships in every status, **10 payments** (one voided), about 350 past attendance records and today's check-ins, plus an Admin
(`admin@hercules.test` / `Passw0rd!local`) and a Staff user in the Auth emulator. It is a superset of the 5-member minimum in FR-14. It covers, relative to today (dates are computed, so every status is always represented):

| Requirement | Seeded member |
|---|---|
| ACTIVE | Rahul (paid in full), Ravi (ends in 8 days, part-paid), Arjun |
| EXPIRING_SOON, ends **today** (0 days) | Sita (part-paid, then completed) |
| EXPIRING_SOON, ends in **exactly 7 days** | Sam (unpaid) |
| EXPIRED | Samira (ended yesterday), Anil (long ago) |
| SUSPENDED | Neha |
| a **partial payment** | Ravi, Meera, Anil, Sita's first payment |
| a member with **2 memberships** | Vikram (expired unpaid, renewed today), Meera (early renewal that stacks) |
| No membership / under 18 | Tara (guardian consent) |

It obeys the app's invariants because it does not write around them: members go through `registerMemberTx` (ID from the counter, consent, audit, search fields), memberships and payments through the same assign / renew / `recordPaymentTx` / `voidPaymentTx`
transactions, under the **real security rules** as a seeded Admin. Only `users/{uid}` documents (which no client can write) and past-day attendance (the rules refuse backdating) are written with the rules disabled, which only the emulator allows.
`npm run reconcile` reports zero drift on a fresh seed (verified).

**Safety (US-8.4b).** `scripts/seedGuard.ts` refuses to run unless `FIRESTORE_EMULATOR_HOST` is a loopback address (`127.0.0.1`, `localhost`, `::1`), and refuses when `NODE_ENV=production`, when `GOOGLE_APPLICATION_CREDENTIALS` is set (it never uses a service-account key),
or when Firebase tooling names a real project (`GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `FIREBASE_PROJECT(_ID)`, `FIREBASE_CONFIG` with a non-`demo-*` id). The seed's own project id is the fixed `demo-hercules-fitness`, so it cannot address any other project. The web app's
`VITE_FIREBASE_PROJECT_ID` is deliberately not consulted (a developer's `.env.local` normally holds the real project). Use `emulators:start` plus a second terminal, not `emulators:exec --project <real id> "npm run seed"`. The guard is unit-tested (`scripts/seedGuard.test.ts`).

`.firebaserc` and `firebase.json` are the only Firebase tooling files; the emulator UI and logs (`firestore-debug.log`) are git-ignored.

## 11. Render deployment plus rules and indexes deployment

(The source spec's "Firebase deployment" becomes two steps: **deploy the rules and indexes to Firebase**, then **deploy the static site to Render**. Do them in this order.)

### 11.1 Deploy Firestore rules and indexes

```bash
npx firebase login
npx firebase use --add        # pick your project; alias it "default" (this rewrites .firebaserc)
npm run deploy:rules          # firestore.rules AND firestore.indexes.json
```

or by hand: **Firestore -> Rules**, paste the whole `firestore.rules`, **Publish**; **Firestore -> Indexes**, create each index of [section 12](#12-firestore-indexes).
Then open **Firestore -> Indexes** and wait until **every index shows Enabled** (a minute or two on an empty database). Until then a list screen shows *"This view needs a database index that is still being built. Try again in a few minutes."*
(the app never shows raw Firebase errors; in `npm run dev` the browser console prints the error code and, for a missing index, the console link that creates it).

### 11.2 Deploy the static site to Render

`render.yaml` is a Render Blueprint (a `web` service with `runtime: static`, so there is no server to pay for or patch):

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run build` |
| Publish directory | `./dist` |
| Node | `NODE_VERSION=22` |
| **SPA rewrite** (required) | `/*` -> `/index.html`, type **Rewrite** (a `routes` entry in `render.yaml`; by hand: the service's **Redirects/Rewrites** tab) |
| Response headers, all paths | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy: frame-ancestors 'none'` (deliberately not a full CSP: a strict one needs testing against Firebase and MUI first) |
| Pull-request previews | off |

Steps:

1. Push the repo to GitHub/GitLab. Render Dashboard -> **New -> Blueprint** and point at `render.yaml` (or **New -> Static Site** and enter the table above by hand). `render.yaml` uses the service name `hercules-fitness`; adjust it (and the authorized domain below) to the name you choose.
2. **Environment variables.** Enter the five values in the Render dashboard (`render.yaml` declares them `sync: false`, so no value is ever in the repo):

   | Render env var | Value |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | web app config |
   | `VITE_FIREBASE_AUTH_DOMAIN` | web app config |
   | `VITE_FIREBASE_PROJECT_ID` | **the production project id** |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | web app config |
   | `VITE_FIREBASE_APP_ID` | web app config |

   Leave `VITE_USE_EMULATORS` **unset** (a production build refuses it anyway). Vite inlines these at build time, so **redeploy after any change**.
3. **Authorize the Render domain in Firebase** (NFR-8): Firebase Console -> **Authentication -> Settings -> Authorized domains -> Add domain** -> `<your-service-name>.onrender.com`, and any custom domain you attach later. Do this before go-live:
   Firebase only sends users back to authorized domains (password-reset continue links, and any future OAuth or redirect flow). `localhost` is already listed.
4. Deploy, then verify in a private window:
   - **Deep link + refresh**: open `https://<service>.onrender.com/members` directly (and press refresh on any inner page). It must load the app, not a 404. (Member profile URLs use the opaque Firestore document id, `/members/<docId>`, per architecture decision D4;
     the rewrite applies to every path.) If it 404s the rewrite is missing.
   - **US-8.6b**: sign in as the bootstrapped admin, register one test member, open the Dashboard. All three must work against production. Then soft-delete the test member.
5. `npm run build` was run locally in Phase 8 and succeeded; the security headers and the rewrite live only in `render.yaml`, so they can only be verified on Render itself.

## 12. Firestore indexes

`firestore.indexes.json` declares **28 composite indexes** (all `COLLECTION` scope). The emulator does **not** enforce indexes, so they are verified two ways: statically (`tests/unit/indexes.test.ts` checks the SAME query plan objects the services execute against this file,
checks that no declared index is unused or duplicated, and scans `src/services` so a new ad-hoc query cannot slip in without a decision) and, finally, by the smoke tests on a deployed project (section 15). Every new query must arrive with its index in the same change.

| # | Collection | Fields | Used by |
|---|---|---|---|
| 1 | `members` | `deleted`, `createdAt` desc | Members list (default, newest registered first) |
| 2 | `members` | `deleted`, `suspended`, `createdAt` desc | status = Suspended |
| 3 | `members` | `deleted`, `hasMembership`, `createdAt` desc | status = No membership |
| 4 | `members` | `deleted`, `searchFullName` | name search: first name or "first last" prefix |
| 5 | `members` | `deleted`, `searchReverseName` | name search: last name or "last first" prefix |
| 6 | `members` | `deleted`, `searchMobile` | mobile prefix search; duplicate-mobile lookup |
| 7 | `members` | `deleted`, `memberId` | Member ID prefix search |
| 8 | `members` | `deleted`, `joiningDate` | Members report; dashboard new-members-per-month counts |
| 9 | `members` | `deleted`, `suspended`, `membership.endDate` asc | Active / Expiring / Expired filters and counts, Expiring soon page, dashboard cards and next-10 table, Expiring report |
| 10 | `members` | `deleted`, `suspended`, `membership.endDate` desc | the same, latest-first; Expired page and report |
| 11 | `members` | `deleted`, `suspended`, `membership.planId`, `membership.endDate` asc | status + plan filter; dashboard plan chart (`endDate >= today` per plan) |
| 12 | `members` | `deleted`, `suspended`, `membership.planId`, `membership.endDate` desc | the same, latest-first |
| 13 | `members` | `deleted`, `membership.planId`, `createdAt` desc | plan filter, registered order |
| 14 | `members` | `deleted`, `suspended`, `membership.planId`, `createdAt` desc | Suspended + plan filter |
| 15 | `members` | `deleted`, `pendingPaise` desc | Pending payments page; dashboard pending `sum` / `count`; Pending report without dates |
| 16 | `members` | `deleted`, `pendingPaise` desc, `joiningDate` asc | Pending report with a joining-date range (two inequalities) and its totals |
| 17 | `memberships` | `memberDocId`, `createdAt` desc | Membership History on the profile |
| 18 | `memberships` | `memberDocId`, `unpaid`, `startDate` asc | record-payment dialog (unpaid memberships, oldest first) |
| 19 | `payments` | `voided`, `paymentDate` desc | Payments page, Revenue report rows |
| 20 | `payments` | `voided`, `method`, `paymentDate` desc | Payments page with a mode filter |
| 21 | `payments` | `memberDocId`, `paymentDate` desc | member payment history (voided rows included) |
| 22 | `payments` | `voided`, `paymentDate` asc, `amountPaise` asc | revenue `sum()`: 12 dashboard months, report totals and breakdown |
| 23 | `payments` | `voided`, `method`, `paymentDate` asc, `amountPaise` asc | revenue per payment mode |
| 24 | `attendance` | `date`, `checkInAt` desc | Attendance page: all of today |
| 25 | `attendance` | `date`, `status`, `checkedOut`, `checkInAt` desc | Attendance page: checked in now |
| 26 | `attendance` | `memberDocId`, `date` desc | member attendance history |
| 27 | `attendance` | `status`, `date` asc | dashboard monthly chart, Attendance report with a status, report totals |
| 28 | `attendance` | `memberDocId`, `status`, `date` asc | Monthly report: days present per member |

No composite index is needed (Firestore's automatic single-field indexes serve them): today's Present / Currently-checked-in counts and the Absent filter (equality only), the Attendance report without a status (`date` range), plan list and trainer list (`orderBy name`),
plan-name uniqueness, "how many memberships use this plan", "how many members have this trainer", and the duplicate-mobile lookup for Admin. **Deployment order matters**: indexes on a big collection take longer to build; deploy them before the data grows, not after.

The indexes differ from the architecture's draft list (section 5.6) in a few places, all recorded in the phase notes: extra plan + registered-order indexes (13, 14), `amountPaise` / `pendingPaise` as the last field of the aggregation indexes (22, 23, 15), the two-inequality pending report (16), and the attendance set (24 to 28).

### Unsupported filter / sort / search combinations

Firestore cannot order by one field while range-filtering another, has no full-text search, and needs an index per shape, so these are **deliberately not offered** (the UI disables or explains them; none is ever applied to only the current page):

| Combination | Behaviour |
|---|---|
| Search together with a status, plan or expiry filter | disabled while a search term is typed ("clear the search to filter"); architecture 5.3 row 8 |
| Sort by expiry without a status or expiry range | not offered: an expiry sort is only enabled once a date filter is set; without one the list stays in registered order (row 9) |
| Expiry range with the Suspended or No-membership status | not applicable (those have no date predicate): the range is ignored for them |
| "Contains" / infix / typo-tolerant search ("ahul" does not find "Rahul") | not supported: prefix, case-insensitive only |
| More than one search term or field at a time | one term; the field is inferred (digits = mobile, `GYM...` = member ID, otherwise name) |
| Sorting the members list by name, pending amount or days remaining | not supported (only registered order, or expiry order under a date filter); the Pending page is sorted by amount, largest first |
| Filtering members by trainer, gender or joining date on the list | not supported (Members report filters by joining date) |
| Pending report by membership **start** date (requirements NEW-20) | replaced by **joining** date (architecture 5.7): the start-date form needs a `deleted` flag copied onto every membership |
| Attendance report newest-first with a status filter | oldest day first only (a descending twin needs another index) |
| Payments: search by member name, by amount range, or by reference | not supported (filters: dates, mode, voided only) |
| Exports above 5,000 rows | capped; split the date range |
| Any list total for an arbitrary filter | shown only where one `count()` is cheap; the pager uses "next page exists" from the extra document |

### Read cost: budget and measured counts (US-8.3a)

Design rule: **no screen reads a collection**. Lists read one page (25 rows + 1 to know whether a next page exists) with cursors, never offsets; figures are `count()` / `sum()` aggregations; the only whole-collection reads are the manual reconcile script and a CSV export (capped at 5,000 rows).

**Method.** `npm run test:perf` seeds a consistent dataset straight into the emulator (10,500 members: 10,182 live; 11,280 memberships; 8,925 payments; 4,448 attendance records; 35,158 documents in 10 s; it must reconcile with zero drift), then runs the real service functions as an Admin under the real rules with the Firestore calls metered.
The emulator has no billing, so the last column applies the **documented billing model** to what the app really asked for: 1 read per document returned (an empty result counts 1); an aggregation is billed 1 read per 1,000 index entries scanned (minimum 1), where the entries are the matching documents;
and every request adds 1 read for the rules' `get(users/{uid})`. **Verify this model and the free-plan daily quota against the current Firebase documentation** (architecture R-5): the model is what I know of the pricing, not something I could observe here.

**Budget (fixed before measuring; my proposal, not agreed with the owner):** every list screen <= 26 documents; the dashboard <= 10 table documents plus the plan list, and <= 200 billed reads for one full load (about 0.4% of a 50,000-reads/day free quota, if that is still the quota).

Measured at 10,500 members (10,182 live), 11,280 memberships, 8,925 payments, 4,448 attendance records (this run; the table is printed by `npm run test:perf`):

| Screen | Documents read | Aggregations | Index entries scanned | Rules reads (users/{uid}) | Billed reads (model) |
|---|---:|---:|---:|---:|---:|
| Members list: all, newest first | 26 | 0 | 0 | 1 | 27 |
| Members list: status Active + sort by expiry | 26 | 0 | 0 | 1 | 27 |
| Members list: status Expiring soon | 26 | 0 | 0 | 1 | 27 |
| Members list: status Expired | 26 | 0 | 0 | 1 | 27 |
| Members list: status Suspended | 26 | 0 | 0 | 1 | 27 |
| Members list: status No membership | 26 | 0 | 0 | 1 | 27 |
| Members list: plan filter | 26 | 0 | 0 | 1 | 27 |
| Members list: name search "ra" | 26 | 0 | 0 | 1 | 27 |
| Members list: mobile prefix | 26 | 0 | 0 | 1 | 27 |
| Members list: member ID prefix | 26 | 0 | 0 | 1 | 27 |
| Expiring soon page (7 days) | 26 | 0 | 0 | 1 | 27 |
| Expiring soon page (15 days) | 26 | 0 | 0 | 1 | 27 |
| Expired page | 26 | 0 | 0 | 1 | 27 |
| Payments page | 26 | 0 | 0 | 1 | 27 |
| Pending payments page | 26 | 0 | 0 | 1 | 27 |
| Attendance: today's list | 26 | 0 | 0 | 1 | 27 |
| Members list: page 22 (cursor) | 26 | 0 | 0 | 1 | 27 |
| Dashboard: member cards, charts, next-10 table | 14 | 22 | 32226 | 24 | 82 |
| Dashboard: pending payments, revenue by month | 0 | 13 | 12518 | 13 | 29 |
| Dashboard: attendance today and by month | 0 | 14 | 4608 | 14 | 32 |
| Dashboard TOTAL (one load) | 14 | 49 | 49352 | 51 | 143 |
| Report MEMBERS: first page | 26 | 0 | 0 | 1 | 27 |
| Report MEMBERS: totals | 0 | 1 | 10182 | 1 | 12 |
| Report EXPIRED: first page | 26 | 0 | 0 | 1 | 27 |
| Report EXPIRED: totals | 0 | 1 | 2244 | 1 | 4 |
| Report EXPIRING: first page | 26 | 0 | 0 | 1 | 27 |
| Report EXPIRING: totals | 0 | 1 | 810 | 1 | 2 |
| Report REVENUE: first page | 26 | 0 | 0 | 1 | 27 |
| Report REVENUE: totals | 0 | 37 | 2307 | 37 | 74 |
| Report ATTENDANCE: first page | 26 | 0 | 0 | 1 | 27 |
| Report ATTENDANCE: totals | 0 | 2 | 4448 | 2 | 8 |
| Report PENDING: first page | 26 | 0 | 0 | 1 | 27 |
| Report PENDING: totals | 0 | 1 | 3786 | 1 | 5 |
| CSV export: Members report at the 5,000-row cap | 5020 | 0 | 0 | 20 | 5040 |

**Result: every list screen reads exactly one page (26 documents), the dashboard is 14 documents + 49 aggregations = 143 billed reads (budget 200), so the monthly-metrics adoption trigger (architecture 5.5) did NOT fire and no counter documents were added.**
Cursor pagination is flat: page 22 cost the same as page 1.

**Scaling (measured at 21,000 members with the same harness):** the dashboard rose to **190** billed reads (14 documents, 49 aggregations, 98,696 index entries), list screens stayed at 27, the Members report totals cost 22, the Revenue totals 75. The dashboard grows by about 4.5 billed reads per 1,000 members
(entries scanned / 1,000); the fixed part (49 aggregations + 51 rules reads + 14 documents = about 114) does not grow. **Extrapolated, not measured: the 200-read budget is reached at roughly 23,000 members.** The three monthly charts are 36 of the 49 aggregations; adopting monthly metrics for them
(architecture 5.5, "chart counters only") would remove those 36 aggregations and their 36 rules reads. Revisit this at about 20,000 members, or earlier if the owner refreshes the dashboard often (each refresh costs a full load).
Other costs worth knowing: the **Revenue report totals** cost up to 37 aggregations (total + 5 modes + up to 31 days), a **CSV export** at the cap costs about 5,000 reads plus 20 rules reads, and the **reconcile script** reads every member, membership, payment and counter document.

## 13. Security rules

`firestore.rules` is **deny by default**: every path not listed is refused, including subcollections and collection-group queries, and every rule that needs a role first requires an active `users/{uid}` document with an exactly-matching role. About 46 KB of source
(the documented limit for a ruleset source is 256 KB; not verified here beyond the emulator accepting it).

### 13.1 One test per Permission-Matrix row (US-8.2a)

`tests/rules/matrix.test.ts` has one test for **each of the 26 rows** of the requirements' Permission Matrix (row 4 has a second, "4b"), each with allowed and denied cases for Admin, Staff, Member (linked and other), anonymous and role-less users. Deeper cases live in one file per collection.

| Matrix row | Test |
|---|---|
| 1 own `users` doc read; 2 write any `users` doc / role forgery | `matrix` rows 1-2, `users.test.ts`, `roles.test.ts` (token-claim forgery ignored) |
| 3 view members; 4 register; 5 edit; 9 suspend / reactivate / soft-delete | `matrix` rows 3-5, 9; `members.test.ts` (56 cases), `counters.test.ts` |
| 6 medical notes (Staff NO); 7 general notes | `matrix` rows 6-7; `medical.test.ts` |
| 8 photo view / upload | `matrix` row 8; `photos.test.ts` |
| 10-11 plans; 12 assign / renew; 13 membership status | `matrix` rows 10-13; `plans.test.ts`, `memberships.test.ts` |
| 14 record payment (Staff NO); 15 payment history (Staff NO); 16 pending amount; 17 void | `matrix` rows 14-17; `payments.test.ts` (overpayment, exact balance moves, immutability, one-way void) |
| 18-20 attendance | `matrix` rows 18-20; `attendance.test.ts` (server-time day, no backdating, suspended blocked) |
| 21 dashboard (Staff non-financial); 22 reports and CSV (Admin only) | `matrix` rows 21-22 (Staff denied payment aggregations, denied the export audit record) |
| 23 trainers; 24 settings | `matrix` rows 23-24; `trainers.test.ts` |
| 25-26 audit create / read / update / delete | `matrix` rows 25-26; `audit.test.ts` (create-only) |
| unauthenticated denial; unlisted paths | `baseline.test.ts` |
| **missing / unknown-role `users` doc denied everywhere** (US-8.2b) | `roles.test.ts`: ten fixtures (no doc, `inactive`, `SUPERADMIN`, `admin`, `"ADMIN "`, no role field, null role, array role, no `active`, `active: "true"`) each tried on every read and on nine write types that an Admin's control test proves valid |
| audit atomicity | `auditAtomicity.test.ts` |
| access-call and expression budget | `budget.test.ts` |

### 13.2 Audit atomicity (architecture 3.4, Phase 8)

A `members`, `memberships` or `payments` document can no longer be written **without** an audit record. Each such write names its audit record in `lastAuditId`, and the rule (`auditAbout`) requires that record to be **created in the same commit**
(its `at` equals `request.time`, which every write of one commit shares, so an older record cannot be re-used), and to be **about this document and this action** (right `entity`, `entityId` and `action`: `MEMBER_CREATED`, `MEMBER_UPDATED`, `MEMBER_DELETED`, `MEMBER_SUSPENDED`,
`MEMBER_REACTIVATED`, `MEMBERSHIP_CREATED` / `RENEWED`, `PAYMENT_CREATED`, `PAYMENT_VOIDED`). The architecture's literal check (`entityId == docId`) had to be adapted: one audit record serves several documents in a commit (an assign / renew touches the membership and the member; a payment touches the payment,
the membership and the member), so the record is matched to the *action*. Balance changes were already tied to their payment through the same record. The remaining risk (a hostile client writing a **wrong but well-formed** audit record) is R-1 and stays documented.

### 13.3 Rules limits: TX-4 and every heavy commit fit (US-8.2, R-9)

Firestore limits a rule evaluation to **1,000 expressions** and a commit to **10 document-access calls per operation and 20 per multi-document commit** (documented limits; the emulator enforces them). `tests/rules/budget.test.ts` runs the real transactions and then re-runs each against a copy of the rules with extra
document accesses / trivial expressions injected, to measure the headroom. Measured (two full runs; the spare-access count moved by one between runs for TX-4 and check-in, so treat it as a range):

| Commit | Documents | Spare document accesses | Spare expressions (`&& true` terms, ~2 expressions each; capped at 60) |
|---|---|---:|---:|
| Register with plan + first payment + medical notes (Admin) | counter, member, medical, membership, payment, 3 audits | 6 | 20+ (about 40 expressions) |
| **TX-4 record payment**: payment + membership + member + audit | 4 | **6 to 7** | 60+ |
| TX-5 void payment | 4 | 8 | n/a |
| TX-2 / TX-3 assign / renew with first payment | membership, member, payment, 2 audits | 9 | 60+ |
| Attendance check-in (Staff) | 1 (+1 member read in the rules) | 8 to 9 | n/a |

**Nothing had to be dropped.** The fallback order in the architecture (drop the check from `members.update`, then from `memberships`) was not needed for the access-call limit. The 1,000-expression limit was the real constraint: adding the audit check to the member-create rule pushed *registration with a plan* over it, so the member-create rule was refactored
into short functions (`memberCreateOk`, `newMemberStamps`, ...) and `hasRole()` lost its redundant `exists()` (a missing `users` doc already makes `get()` error, which every rule treats as a denial; still tested). **The registration commit now has only about 40 expressions of headroom**: a further check on it must be paid for by another simplification.
The test fails if headroom falls below 2 accesses / 20 `&& true` terms on any of these.

### 13.4 Other Phase 8 rules changes

- `trainers` are readable by Staff and Admin only (the matrix says Member: no; it was any signed-in role).
- Removed nothing else. Rules still cannot check: that `endDate` equals `start + N months - 1 day`, "delete a plan only when unused", or plan-name uniqueness (the client does them; a hostile Admin client could write a well-formed but wrong period).

### 13.5 Secrets and keys (US-8.2c)

Verified by `tests/unit/secrets.test.ts` (runs in `npm test`) and by hand: no service-account key, private key, API-key-shaped value or `firebase-admin` dependency anywhere in the tree; `.env*` (except `.env.example`), `*firebase-adminsdk*.json`, `serviceAccount*.json`, `*.pem`, `dist`, emulator state and logs are git-ignored;
the real values in `.env.local` appear in no other file; `render.yaml` holds the five `VITE_FIREBASE_*` keys as `sync: false`. This folder is **not a git repository**, so "committed" means "present outside the ignored paths"; when you `git init`, check `git status` once before the first commit. The web config is baked into the public bundle by design.

### 13.6 Known gaps and accepted risks (read these before go-live)

1. **R-1, client trust**: no server, so rules cannot verify business arithmetic (period end dates) or that an audit record's *content* is truthful.
2. **General notes (matrix row 7)**: the matrix says a Member cannot see them, but they live on the `members` document, which a Member may read for their own record (rules cannot hide one field). Harmless while Member login is off; move them to a separate document before enabling Member login. Medical notes are separate and Admin-only.
3. **Staff and money on the dashboard / lists**: Staff are denied `payments` and every payment aggregation, but `members.pendingPaise` is readable and aggregatable by Staff (the matrix allows "Amount Pending" read-only on lists). The "non-financial cards only" rule for Staff is UI-enforced.
4. **Reports (row 22) are Admin-only in the UI and in the export audit**, not in the read rules: Staff can read `members` / `attendance` through the SDK (the matrix lets them view members), so a modified Staff client could read rows without the export trail (R-1; reads cannot be audited).
5. **`suspendedReason` is free text visible to Staff** and must not carry health details (the UI says so; it is never copied to the audit log).
6. **Settings (row 24)** has no document: the page is read-only and both `settings` and `notifications` are denied to everyone.
7. **Clock**: writes are bounded by the server clock, but "today" on screen uses the device clock. The clock-skew banner (Appendix C) warns; it cannot prevent a wrong display.
8. The emulator does not enforce indexes, and the security headers / SPA rewrite exist only in `render.yaml`: both are unverified until a real deployment (section 15).

## 14. Scheduled processing (deferred)

(The source spec's "Cloud Functions deployment" does not apply: there are no Cloud Functions.) Nothing in the MVP runs on a schedule. Membership status is computed live from the dates (there is no daily mass status update), so "who is expiring in 7 days" is always a query: the Expiring soon page and its report use the same predicate.
Requirements FR-12, US-7.3 and AC 18 are parked.

- **Notifications** are an interface plus a stub that delivers nothing (`src/services/notificationService.ts`); no UI creates notification records (NEW-21), and `notifications` stays denied by the rules.
- **When you want reminders**: a **Render Cron Job** (paid) running a small Node script with the Firebase **Admin SDK** and the provider's SDK, secrets in Render environment variables, or Firebase Blaze + a scheduled Cloud Function. That code runs the Expiring predicate once a day and writes idempotent notification records
  (deterministic id such as `{memberDocId}_{type}_{endDate}`). It is a separate deployable: **never add Admin SDK credentials to this repo or to the browser bundle.** The full checklist (consent for messaging, first name only in messages, guardians for minors, opening the `notifications` rule) is in [Appendix G, Phase 7](#how-to-add-a-real-provider-later).

## 15. Production checklist

Nothing below has been done by this repository: they are actions in *your* Firebase and Render accounts. Tick each one.

**Before deploying**
- [ ] A **separate production Firebase project** exists (never the dev project; the seed must never touch it). Firestore created in production mode, region `asia-south1` (or your choice; it cannot change).
- [ ] Authentication: Email/Password on; **sign-up disabled**; **email enumeration protection on** (section 6).
- [ ] **Rules deployed** (`npm run deploy:rules`) and the deployed ruleset matches `firestore.rules` (Firestore -> Rules shows today's publish time).
- [ ] **Indexes deployed** and every one of the 28 shows **Enabled** (Firestore -> Indexes).
- [ ] **Admin bootstrapped**: Auth user + `users/{uid}` with `role: "ADMIN"`, `active: true` (section 6). A second Admin account exists as a spare, so a broken `users` document cannot lock you out.
- [ ] **Seed data NOT run** against production (it cannot be: it only reaches a loopback emulator). If demo data ever got in by hand, delete it before go-live.
- [ ] `.firebaserc` points at the production project; `git status` shows no `.env*` file and no key file.
- [ ] `npm ci && npm run typecheck && npm run lint && npm test && npm run build` pass (and `npm run test:rules` on a machine with Java).

**Render**
- [ ] Static site created from `render.yaml`; the five `VITE_FIREBASE_*` env vars entered with the **production** values; `VITE_USE_EMULATORS` not set.
- [ ] SPA rewrite `/*` -> `/index.html` present; a deep link and a refresh load the app.
- [ ] The Render domain (and any custom domain) is in Firebase **Authorized domains**.

**First verification on production (US-8.6b)**
- [ ] Log in as the Admin; a Staff or role-less account is refused.
- [ ] Register one test member; the profile shows the ID `GYM-YYYY-0001`; open the Dashboard (no index error); then soft-delete the test member.
- [ ] `firestore -> auditLogs` shows the audit records; there is no `notifications` or `settings` collection.

**Data protection and operations**
- [ ] **Backup / export approach decided and written down.** Firestore's managed export / scheduled backups are Google Cloud features that, to my knowledge, need a billing-enabled (Blaze) project and a Cloud Storage bucket, which this project's no-paid-plan decision avoids; verify the current requirements.
  Options: (a) enable Blaze only for backups with a budget alert and a weekly `gcloud firestore export` to a restricted bucket with a retention rule; (b) accept the risk and rely on the app's CSV reports (partial: no memberships history, no audit, 5,000-row cap, no medical notes: **not a backup**);
  (c) an owner-run Admin-SDK script kept **outside** this repo. An export contains personal and medical data: restrict access, set retention, and remember that anonymizing a member (Appendix D) does not remove them from old exports.
- [ ] **Consent wording** in `src/constants/consent.ts` (`consent-v1`) is placeholder text: get it reviewed, change `CONSENT_VERSION` when it changes.
- [ ] **Retention period** and the **anonymization procedure** (Appendix D) agreed with the owner / legal advice (NEW-16). Soft delete does **not** satisfy an erasure request by itself.
- [ ] Check the **current Spark limits and pricing** against [Read cost](#read-cost-budget-and-measured-counts-us-83a); decide when to re-measure (about 20,000 members).
- [ ] Run `npm run reconcile` against production once after go-live and then occasionally (Appendix B): it needs `--yes` and bills one read per document.
- [ ] Know the rollback: Render keeps previous deploys (redeploy one); rules can be re-published from any earlier `firestore.rules`; indexes are additive.

## Appendix A. Testing

| Command | Covers | Result in this Phase 8 run |
|---|---|---|
| `npm test` (no network, no emulator) | business logic, validation, CSV, attendance day boundary, indexes, secrets, seed / reconcile guards, clock skew, UI and route tests | **47 files, 773 tests passed** |
| `npm run test:rules` (emulator) | one test per Permission-Matrix row, per-collection rules, roles, audit atomicity, rules budget, plus real service transactions | **18 files, 396 tests passed** (was 9 files / 182 tests at the start of Phase 8) |
| `npm run test:perf` (emulator, about 2 min) | read counts on a 10,500-member dataset | **27 tests passed**; numbers in section 12 |
| `npm run typecheck`, `npm run lint`, `npm run build` | | all clean; `dist/` builds (largest chunk 560 kB, the Firebase SDK) |

**US-8.1 business-logic suites (`npm test`):** `src/domain/status.test.ts` (the D-4 boundary table, 23:59:59 vs 00:00:00 IST, 18:30 UTC, five device time zones, suspended wins, invalid period), `renewal.test.ts` (FR-5 month-end table, leap years, early / on-end-date / expired renewal, stacking),
`queryPredicates.test.ts` (every end date lands in exactly one status bucket, agreeing with the status function), `payment.test.ts` (AC-8: 1500 = 500 + 700 -> 300, overpayment, decimals, void, multi-membership dues, card-number guard, IST payment date), `validation/*.test.ts` (member, payment, plan, trainer, auth),
`attendance.test.ts` (IST day id and boundary, currently-checked-in reset, NEW-12), `csv.test.ts` (formula neutralization, RFC 4180, BOM), `reportExport.test.ts` (the 5,000-row cap, cancel, no partial file), `reports.test.ts` (privacy allow-list, file name, audit metadata), `reconcile.test.ts`, `clockSkew.test.ts`, `dates.test.ts`, `money.test.ts`.
**Integration (`test:rules`):** `tests/integration/lifecycle.integration.test.ts` runs the real transactions (month-end, stacking renewal, concurrent payments cannot overpay, idempotent retries, void, suspension, attendance, drift check) under the real rules, next to `members.integration.test.ts`.

## Appendix B. Reconcile (read-only drift check)

`scripts/reconcile.ts` recomputes every denormalized total from the source of truth and reports what does not match (architecture 2.7, R-2). It **never writes and never repairs**; exit code `1` = drift found, `2` = could not run.

```bash
# emulator
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run reconcile

# a real project: signs in as an ADMIN of the app (no service account exists); reads are billed, so --yes is required
set -a; . ./.env.local; set +a
RECONCILE_EMAIL=owner@example.com RECONCILE_PASSWORD='...' npm run reconcile -- --yes
```

Checks: each membership's `paidPaise` = sum of its non-voided payments, `outstandingPaise` = amount - paid, the `unpaid` flag, no overpayment; each member's `pendingPaise` = sum of the outstanding of their memberships; the member's membership summary points at the latest membership
(and `hasMembership` is right); payments and memberships have their parents and agree on the member; member IDs are unique and well-formed and each year's counter is not behind the highest ID issued. A **soft-deleted** member's frozen pending total (a payment voided after deletion cannot update it) and a counter that is ahead of the members are reported as `note`, not as drift.
The report prints ids, paise and dates only, never names, mobile numbers or notes. The password is read only from the environment. **If it reports drift**: find the transaction that caused it (the `payments` are the source of truth), correct the denormalized field by hand in the console, and re-run; do not "fix" a payment to match a total.
Tested by `src/domain/reconcile.test.ts`, `scripts/reconcileGuard.test.ts`, the lifecycle integration test (clean after normal use; detects a hand-edit; leaves every document byte-identical) and on the seed and the 10,500-member dataset (zero drift).

## Appendix C. Clock-skew warning banner

Every status, "days remaining" and "today" on screen uses the device clock, while the rules bound writes by the server clock. A device with a wrong clock therefore shows wrong statuses without any error. The signed-in shell shows a **persistent warning banner** (no close button) when the device clock differs from the server by **more than 5 minutes**
(`This device's clock is about N minutes/hours/days ahead|behind. Dates and statuses may be incorrect. Set the date and time to automatic and reload the page.`).

**Deviation from the architecture text (6.6)**, which compares a `serverTimestamp()` value after a write: the web SDK returns no commit time from a transaction, so that needs a read-back of the written document, an extra billed read per write, which the design forbids ("zero extra reads"). Instead the banner uses a time the **server** stamps for free: the `iat` (issued-at) of a freshly minted Firebase Auth ID token
(`src/services/clockSkewService.ts`: one forced token refresh, an Auth request, not a Firestore read; `iat` has one-second resolution). It is measured when the shell mounts, every 30 minutes, and when the tab regains focus after that long. A failed measurement (offline) never raises a warning. Unit-tested: `clockSkew.test.ts` (the 5-minute boundary, both directions),
`useClockSkew.test.tsx`, `ClockSkewBanner.test.tsx` and the route test. **Not verified in a browser or against real Firebase Auth**; the Auth-emulator token's `iat` comes from the same machine clock, so the emulator cannot demonstrate a skew.

## Appendix D. Manual anonymization procedure (DPDP, NEW-16)

**Status: a documented manual procedure, not an automated feature. The retention period, the exact field list and the consent wording are decisions for the owner and legal advice** (India DPDP Act 2023: this README does not state what the law requires). Soft delete hides a member but keeps every personal field; it does not satisfy an erasure request.
The app cannot anonymize: the rules refuse any client write to a deleted member, and memberships, payments, attendance and audit records are immutable to every client, so the work is done by an Admin **in the Firebase console** (which bypasses rules), one member at a time. No script and no Admin-SDK code ships in this repo.

**Goal**: remove what identifies the person; keep what the gym must keep (payments, memberships, attendance counts, the audit trail's *existence*), all tied to the pseudonymous `GYM-YYYY-NNNN` ID.

1. **Find the member** (`members`, by `memberId`; note the document id `<D>`). Confirm the request is genuine and the person is the data subject (or their guardian, for under 18) and record the request date and your decision **outside the app** (a private log: date, `memberId`, what was done, by whom). Do not put the person's name in that log.
2. **Soft-delete first** in the app if not already deleted (Members -> Delete), so nothing else writes the member while you work.
3. **`members/<D>`**: set `firstName` = `Erased`, `lastName` = `Member`, `displayName` = `Erased Member`, `searchFullName` = `erased member`, `searchReverseName` = `member erased`, `mobile` = `""`, `searchMobile` = `""` (so the duplicate-mobile lookup no longer finds them), `email` = null, `address` = null,
   `emergencyContact` = null, `generalNotes` = null, `suspendedReason` = null, `hasPhoto` = false, `dateOfBirth` = a neutral Timestamp (for example 01/01/1900 IST, 1899-12-31T18:30Z). Keep `memberId`, `deleted`, `pendingPaise`, the membership summary and the timestamps. (`consent.byName` is the *staff* name who took consent, not the member's.)
4. **Delete** `memberMedical/<D>` (health data) and `memberPhotos/<D>` (the photo).
5. **Snapshots of the name** that were copied into other documents (they are historical copies and are never refreshed): in `memberships` where `memberDocId == <D>` set `memberDisplayName` = `Erased Member`; in `payments` the same field (also blank `notes` and any `voidReason`, and decide with the owner whether `transactionReference`, which can be a UPI id, stays for accounting);
   in `attendance` where `memberDocId == <D>` set `memberName` = `Erased Member`.
6. **`auditLogs`**: records about the member carry `entityLabel` = `GYM-YYYY-NNNN First Last`. Change the label to `GYM-YYYY-NNNN Erased Member` on records whose `entityId` is `<D>` or one of the member's membership / payment ids. This edits an append-only log (the rules forbid it to clients, not to the console): note that in your private log. `metadata` holds field names, plan and amounts only.
7. **Auth / Users**: a member has no login in the MVP. If you ever created one, delete the Auth user and its `users/{uid}` document.
8. **Backups and exports**: anonymizing does not change old exports, CSV files a staff member downloaded, or screenshots. Delete or expire exports that contain the person (section 15, backups) and ask staff to delete downloaded CSVs.
9. **Verify**: search the app for the old name and mobile (nothing), open Payments / Reports (rows show `Erased Member`), run `npm run reconcile` (money is untouched, so zero drift).

Restoring a deleted member is not supported in the MVP (NEW-16).

## Appendix E. Project layout

```
src/
  config/env.ts          Zod-validated VITE_* config, ConfigError naming missing keys
  firebase/app.ts        initializeApp + getAuth + getFirestore (+ emulator wiring). Auth and Firestore only.
  services/              the ONLY layer that imports Firebase: auth, users, members (queries / transactions / photo / medical), plans, memberships, payments, attendance,
                         reports (queries / CSV export), trainers, dashboard, notifications (stub), clockSkewService, reconcileQueries (manual full scan), queryBuilder, txHelpers, errors, audit.
                         Each *Transactions / *Queries module takes `db` so the emulator tests and the seed run the same code.
  domain/                pure logic, no Firebase: dates (IST), status, renewal, queryPredicates, query plans, payment, attendance, reports + CSV, reconcile, clockSkew, money (paise), search, photo rules, validation schemas
  context/ hooks/ routes/ layouts/ components/ pages/ constants/ types/ theme/ utils/
tests/rules/             Firestore rules tests (emulator): matrix, per collection, roles, audit atomicity, budget; fixtures.ts / setup.ts
tests/integration/       real service transactions against the emulator (members, lifecycle)
tests/unit/              index audit, secrets scan
tests/perf/              10k+ member dataset + read-cost measurement
scripts/                 seed (+ guard), reconcile (+ guard)
```

Layering rule (enforced by ESLint): everything under `src/` except `src/services` and `src/firebase` may not import `firebase/*`; they call services or hooks. `src/types` is Firebase-free.

## Appendix F. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Application is not configured" screen | A `VITE_*` value is missing. The screen names the key. Set it and restart `npm run dev` (or redeploy on Render). |
| "You do not have access to this application" right after a correct password | No `users/{uid}` doc, `active` is not `true`, `role` is not exactly `ADMIN`, or the role is Staff/Member (the app admits ADMIN only). |
| "Could not verify your access" | Network/Firestore unavailable while reading `users/{uid}`; use **Try again**. |
| Password-reset link or a future redirect flow fails on the Render site only | The Render domain is not in Firebase **Authorized domains** (section 11, step 3). |
| Deep link returns 404 on Render | The `/*` -> `/index.html` rewrite is missing (section 11). |
| A list, the dashboard or a profile says *"This view needs a database index that is still being built."* | A composite index is missing or still building. `npm run deploy:rules`, wait for **Enabled**. In `npm run dev` the console prints the console link that creates a missing one (add it to `firestore.indexes.json`). |
| A screen says *"You do not have permission to view this."* | The rules refused the read: the current `firestore.rules` are not deployed, or the signed-in role may not read it. The dev console prints `permission-denied`. |
| A write fails with permission-denied although the same action worked before | Since Phase 8 the rules require the audit record in the same commit. A modified or very old client that writes without it is refused by design; use the current build. |
| Red banner: "This device's clock is about ... ahead / behind" | The device date or time is wrong. Set it to automatic and reload (Appendix C). |
| In `npm run dev`, login is refused and you want to know why | The browser console shows a development-only warning naming the reason (field TYPES only, never values). Production builds log nothing. |
| `npm run test:rules` / `test:perf` cannot start | Install Java 21+; the first run downloads the Firestore emulator. |
| `npm run seed`: "Seed refused: ..." | By design (section 10): not a loopback emulator, `NODE_ENV=production`, service-account credentials set, or Firebase tooling naming a real project. |
| `npm run reconcile`: "Reconcile refused: ..." | Set `FIRESTORE_EMULATOR_HOST`, or the five `VITE_FIREBASE_*` values + `RECONCILE_EMAIL` + `RECONCILE_PASSWORD` + `--yes` (Appendix B). |

## Appendix G. Phase-by-phase notes (Phases 2 to 7)

The notes below were written as each phase was built and are kept because they record deviations from the architecture and the per-phase smoke tests. Two things changed in Phase 8: **the "dedicated test pass ... deferred to the final test pass" notes are resolved** (Appendix A), and section references such as "(section 4)" inside these notes now mean the numbered sections above (see the map in the Contents).
Where a phase note lists indexes, the authoritative and complete list is [section 12](#12-firestore-indexes). The Phase 2 "Erasure (DPDP) note" is superseded by [Appendix D](#appendix-d-manual-anonymization-procedure-dpdp-new-16).

### Phase 2: Members

#### What is new

- **Members**: register (Member ID `GYM-YYYY-NNNN` from a per-year counter, allocated in the same transaction as the
  member), list with server-side search and cursor pagination, profile, edit (with a concurrency guard), soft delete.
- **Duplicate mobile is a WARNING** (NEW-14): families share phones, so a mobile number that another member already has is not
  refused. The form shows a warning (not an error) naming the existing member with a link, and submit stays disabled until you tick
  **"Register anyway"** (**"Save anyway"** when editing a member's number). A soft-deleted owner is named as deleted and needs no
  confirmation. The check is a best-effort query of `members.searchMobile` before the write (it is repeated at save time in case the
  blur lookup was skipped); it is not atomic, so two people registering the same new number at the same instant can both pass it.
- **Consent + under-18**: registration records consent (who, when, wording version `consent-v1`). Under 18 (computed from the
  date of birth on the IST date) requires guardian details and guardian consent. **The consent wording in
  `src/constants/consent.ts` is placeholder text: get it reviewed before production.**
- **Medical notes** are Admin-only, in their own `memberMedical/{id}` document (rules cannot hide one field). Staff never
  render or read them; they never appear in audit records, lists or exports.
- **Profile photo**: JPEG/PNG/WebP up to 5 MB, resized to at most 512x512 and compressed to about 100 KB in the browser
  (re-encoding removes EXIF/GPS data), stored as base64 in `memberPhotos/{id}`, never in list rows.
- **Trainers**: simple CRUD (name, mobile, active) on the Trainers page; used as a dropdown on the member form.
- **Audit**: member created / updated / deleted, written in the same transaction as the change (append-only; field NAMES only).
- **Dashboard**: Total Members and a new-members-by-month chart (by joining date, last 12 IST months). Other cards show an en
  dash with "Available after Phase N".

Registration has **no plan or payment sections** yet (they arrive in Phases 3 and 4). Every member starts with "No membership".

#### What you must deploy (Phase 2 needs new rules and indexes)

The app will not work against the old Phase 1 rules (every members query would be denied) and the list needs its indexes.

1. `.firebaserc` still holds the placeholder project `demo-hercules-fitness`. Either point it at your project:

   ```bash
   npx firebase login
   npx firebase use --add          # choose hercules-fitness-e58a0, alias "default"
   npm run deploy:rules            # deploys firestore.rules AND firestore.indexes.json
   ```

   or do it by hand in the console: **Firestore -> Rules**, paste the whole `firestore.rules`, **Publish**; then create the
   indexes (below).
2. **Indexes** (`firestore.indexes.json`, all on collection `members`, 8 composite indexes). `npm run deploy:rules` creates them.
   Building takes a minute or two; until then a list/search view shows *"This view needs a database index that is still being built. Try
   again in a few minutes."* (the app never shows raw Firebase errors). In `npm run dev` the browser console also prints the Firebase error
   code and, for a missing index, the console link that creates it; production builds print nothing. The indexes are: `deleted+createdAt(desc)`, `deleted+suspended+createdAt(desc)`,
   `deleted+hasMembership+createdAt(desc)`, `deleted+searchFullName`, `deleted+searchReverseName`, `deleted+searchMobile`,
   `deleted+memberId`, `deleted+joiningDate`. (`tests/unit/indexes.test.ts` fails if a query is added without its index.) Phase 3 adds seven more
   (see its section), so deploy the current `firestore.indexes.json`, not this list.
3. Nothing else: no new environment variables, no new Firebase products.

#### New Firestore collections

| Collection | Doc id | Purpose |
|---|---|---|
| `members` | auto id (`memberId` field = `GYM-2026-0001`) | profile + search fields; no medical notes, no photo |
| `memberMedical` | = member id | Admin-only medical notes |
| `memberPhotos` | = member id | one compressed photo (base64 data URL) |
| `trainers` | auto id | name, mobile, active |
| `counters` | `memberId-2026` | `{ year, lastSeq, lastMemberDocId }`, +1 per registration, never reset; each increment names the one new member created in the same commit |
| `auditLogs` | auto id | append-only (Admin can read in the console; there is no viewer UI) |

Dates that mean a calendar day (date of birth, joining date) are stored as Timestamps at 00:00 IST. Money (later phases) is
integer paise: `pendingPaise` is `0` for every Phase 2 member.

#### Seed data (local emulator only)

```bash
npx firebase emulators:start --only auth,firestore     # terminal 1
npm run seed                                           # terminal 2
```

The seed creates 12 members (one under 18 with guardian consent, one with medical notes, joining dates spread over the
last year so the chart has data), 3 trainers, 3 plans, memberships in every status (see Phase 3), 10 payments (see Phase 4) and attendance (see Phase 5), and an Admin (`admin@hercules.test` / `Passw0rd!local`) and a Staff user in the
Auth emulator. Then set `VITE_USE_EMULATORS=true` in `.env.local` and `npm run dev` (section 10).
It **refuses to run against anything except a loopback emulator** (`FIRESTORE_EMULATOR_HOST` must be 127.0.0.1 / localhost / ::1),
never needs a service-account key (it refuses to run if `GOOGLE_APPLICATION_CREDENTIALS` is set) and cannot seed a real
project. Members are created through the same transaction the app uses, under the real security rules.

#### Tests added in Phase 2

- `npm test`: domain (dates, money, search, member ID, validation, photo ladder), form/page tests, index coverage, seed guard.
- `npm run test:rules` (needs Java 21+): rules tests for members / memberMedical / memberPhotos / trainers /
  counters / auditLogs **and** integration tests in `tests/integration` that run the real registration / edit / delete
  transactions and list queries against the emulator (8 concurrent registrations get 8 distinct sequential IDs; the duplicate-mobile
  warning and its confirmation; rollback; conflict guard).

#### Manual smoke test for Phase 2 (about 10 minutes)

Before you start, in the Firebase console open **Firestore -> Indexes** and confirm every index shows **Enabled** (an index that is still
**Building** makes list screens show the "index is still being built" message; wait and retry). Then sign in as the Admin:

1. **Dashboard**: Total members shows a number; the chart shows "New members by month"; the cards for payments and attendance show an en dash
   and "Available after Phase N" (the status cards are real since Phase 3). Click **Refresh**.
2. **Trainers**: add "Test Trainer" (name only). Try an empty name and a 5-digit mobile (both blocked with a message). Edit it,
   deactivate it, add a second active one.
3. **Register member** (Members -> Register member):
   - Submit the empty form: each required field shows its own message and nothing is saved.
   - Enter a mobile like `+91 98765 43210` (it normalizes); date of birth today minus 10 years: an "Under 18" notice appears, the
     guardian fields become required and the consent text changes to guardian consent.
   - Fill it in, tick consent, choose a photo (try a PDF and a 6 MB image first: both are refused), submit. You land on the
     profile with a toast showing the new ID `GYM-YYYY-NNNN`.
   - Register a second member with the **same mobile**: the form shows a *warning* naming the first member with a link, and submit stays
     disabled until you tick "Register anyway". Tick it and register: the second member gets the next ID.
4. **Profile**: consent line (when/who/version), Under 18 chip, photo, Membership / Payment / Attendance / Membership history
   sections say "No data yet", Notes shows general notes and (Admin) medical notes.
5. **Edit**: change the address and save (toast "Member updated"). Open the same member's Edit page in two tabs, save in
   tab 1, then save in tab 2: tab 2 must refuse with "changed by someone else" and a **Reload record** button.
6. **Members list**: newest first, 25 per page with Next/Previous. Type `rah` (name prefix), a mobile prefix, `GYM-2026-00`:
   results follow; `ahul` must NOT find Rahul. While the search box has text, every filter and the sort are disabled with an
   explanation. Clear it and pick Status: Suspended / No membership.
7. **Delete**: delete a member from the list or profile: a confirm dialog explains the effect; afterwards the member is gone from
   the list, dashboard count and search, the profile URL shows "Member not found", and the same mobile can be registered again.
8. **Firebase console check**: `auditLogs` has MEMBER_CREATED / MEMBER_UPDATED / MEMBER_DELETED entries with field names only
   (no medical text); `members` documents contain no medical notes.

#### Not verifiable without a browser / real project

Phases 2 and 3 were built and tested with unit, component and emulator tests, not in a real browser and not against your Firebase
project. Things only you can confirm: the photo compression on real photos in your browser, the chart rendering, and the
first-load index creation on the real project.

#### Erasure (DPDP) note

Deleting a member is a **soft delete** (the record and its audit trail are kept): it hides the member but does not satisfy a
legal erasure request. The manual anonymization procedure, the retention period and the consent wording are owner/legal
decisions to make before production (NEW-16).

### Phase 3: Plans, memberships and expiry

#### What is new

- **Membership Plans** (sidebar): Admin creates, edits, activates / deactivates and deletes plans (name, duration in days or months, price in
  rupees, description); Staff can view. Names are unique case-insensitively (a best-effort check), the duration is a positive whole number,
  the price is above 0. Editing a plan never changes existing memberships (they keep their own amount and dates). A plan can be deleted only when
  no membership references it, including memberships of deleted members; otherwise deactivate it.
- **Assign / renew** (Admin only): the register form gets an optional **Membership** section (plan + start date; end date and total amount are
  calculated and read-only), and the profile / list / Expiring / Expired pages have **Assign plan** and **Renew**. Each is ONE transaction that writes
  the new membership, the member's summary (latest end date, plan, pending amount) and the audit record together. A renewal starts the day after the
  latest end date if that has not passed (early renewals stack), or today if it has; the dates are recomputed inside the transaction at the moment you
  confirm, and the success message shows the final dates. History is never overwritten (rules refuse any update or delete of a membership). A renewal is
  blocked while the member is suspended.
- **Status** (Active 8+ days left, Expiring soon 0 to 7, Expired, Suspended, No membership) is always computed from the stored end date in IST calendar days and
  the stored suspended flag; nothing is written daily. **Suspend / Reactivate** (Admin) only sets the flag: the dates are unchanged. A member without a
  membership cannot be suspended. The suspension reason is optional free text that Staff can see and that is never copied to the audit log: do not put health
  details in it.
- **Expiring soon** (`/members/expiring`; window 1 / 3 / 7 / 15 days, default 7) and **Expired** (`/members/expired`, most recently expired first): paginated,
  server-side, with days remaining / days since expiry, the unpaid amount (the member's dues from their memberships) or the previous plan and amount, and a Renew button.
- **Members list** filters: Status, Plan (the plan of the latest membership) and an expiry date range, plus Sort by expiry. Only the supported combinations of the
  architecture (section 5.3) exist: a date status or an expiry range forces the expiry sort; expiry sorts are disabled without a date filter; while you type a search
  every filter is disabled (never applied to the current page only). Dashboard cards link here with the same filter.
- **Profile**: status badge with start, expiry and days remaining, a real Membership section and a Membership History table (newest first, "Show more").
- **Dashboard**: Total / Active / Expiring / Expired / Suspended / No membership cards (aggregation counts built from the same predicates as the list filters, so a
  card equals its list), members-per-plan chart, and the next 10 expiring memberships (a limited query). Nothing reads a whole collection.
- In Phase 3 every membership started **unpaid**, so a member's pending amount was the sum of the prices of their memberships (Phase 4 adds the payments that reduce it).

#### What you must deploy (Phase 3 needs new rules AND new indexes)

Phase 3 collections (`membershipPlans`, `memberships`) are denied by the Phase 2 rules, and the new list / dashboard queries need seven new composite indexes.

```bash
npm run deploy:rules     # deploys firestore.rules AND firestore.indexes.json (see section 11 for the project setup)
```

or by hand: **Firestore -> Rules**, paste the whole `firestore.rules`, **Publish**; then create the indexes. New indexes in `firestore.indexes.json`:

| Collection | Fields | Used by |
|---|---|---|
| `members` | `deleted`, `suspended`, `membership.endDate` asc | Active / Expiring / Expired filters and counts, Expiring and Expired pages, dashboard table |
| `members` | `deleted`, `suspended`, `membership.endDate` desc | same, latest-first sort and the Expired page |
| `members` | `deleted`, `suspended`, `membership.planId`, `membership.endDate` asc / desc (2 indexes) | the same with a plan filter; plan chart |
| `members` | `deleted`, `membership.planId`, `createdAt` desc | plan filter, registered order |
| `members` | `deleted`, `suspended`, `membership.planId`, `createdAt` desc | Suspended + plan filter (architecture section 5.3 row 5; this index is not in the architecture's list) |
| `memberships` | `memberDocId`, `createdAt` desc | Membership History |

Wait until **Firestore -> Indexes** shows every index as **Enabled** before using the new screens (until then they show "This view needs a database index that is still
being built. Try again in a few minutes."). No new environment variables or Firebase products. `tests/unit/indexes.test.ts` checks every query plan against the index file.

#### Rules changes worth knowing (Phase 2 hardening and Phase 3)

- Registration: the member-ID counter now also records `lastMemberDocId`, and the rules require the counter increment to name exactly the one new member created in the same
  commit (one increment cannot serve two members). Search fields must be consistent with the name and mobile (exact for plain-ASCII names; lower-case only for other scripts, because
  Unicode normalization cannot be computed in rules). Every member update must write a NEW `lastAuditId`. Medical notes can only be written for a member that exists.
- Staff can no longer read or list soft-deleted members (every Staff query is constrained to `deleted == false`), and no photo can be added to a soft-deleted member.
- Plans: Admin writes, Staff reads. Memberships: Admin creates only together with the member-summary update (the summary must mirror the new membership, dues grow by exactly its
  outstanding amount, the latest end date only moves forward, the snapshot equals the active plan); never updated or deleted; a member can never change an expiry.
- Not enforced by rules (needs a server): that `endDate` equals `start + N months - 1 day`, "delete a plan only when unused", and plan-name uniqueness. The client does them and they are
  unit / emulator tested; a hostile Admin client could write a well-formed but wrong period (documented accepted risk R-1).

#### Seed data

`npm run seed` (emulator only, see Phase 2) now also creates 3 plans (Monthly 1 month Rs 1,500; Quarterly 3 months Rs 4,000; 10-Day Pass Rs 600) and memberships relative to today:
an Active one, one ending **today** (Expiring, 0 days), one ending in **exactly 7 days** (Expiring), one ending in **8 days** (Active), one that ended **yesterday** (Expired), a long-expired
one, a **suspended** member, a member with **two** memberships (expired then renewed today), an **early renewal that stacks**, a **future-dated** membership and a member with **no
membership**. All go through the same transactions as the app.

#### Manual smoke test for Phase 3 (about 15 minutes; after the indexes are Enabled)

1. **Plans**: add Monthly (1 month, 1500), try a duplicate name / duration 0 / price 0 (each blocked with a message). Edit the price, deactivate the plan, reactivate it. Delete a plan that is
   not used (works); try to delete one that has memberships (refused, suggests deactivating).
2. **Register with a plan**: Members -> Register member: choose a plan, set the start date to `31/01` of some year with a 1-month plan and check the calculated end date is `27/02` (non-leap); leave
   a plan empty for another member. After saving, the profile shows the badge, dates, days remaining and one Membership History row; the toast shows the final dates.
3. **Assign / renew**: on the member with no plan use **Assign plan**. Renew a member that ends in the future: the new start is the day after the old end date and the old row is unchanged.
   Renew an expired member: the start is today. Renew twice in a row: the second period starts after the first.
4. **Suspend**: Suspend a member (optionally with a reason): badge Suspended, Renew is disabled, the member disappears from Active / Expiring / Expired and appears under Suspended.
   Reactivate: the status is computed from the dates again.
5. **Expiring soon / Expired pages**: windows 1 / 3 / 7 / 15 list only members ending within the window (a member ending today is in every window; one ending in 8 days only in 15); the
   days-remaining column and unpaid amount are shown; Renew works and removes the member from the list. The Expired page lists most recent first with days since expiry and the previous plan / amount.
6. **Members list**: Status = Expiring soon shows the same members as the dashboard card. Add a plan filter and an expiry date range; try Status = Expired with a range in the future (empty
   state explaining no overlap). Sort by expiry is only enabled once a status / range is chosen. Typing in the search box disables every filter.
7. **Dashboard**: the cards add up (Total = Active + Expiring + Expired + Suspended + No membership), the plan chart and the next-10 table match the data; **Refresh** works.
8. **Firebase console**: `membershipPlans`, `memberships` (amounts are integer paise, e.g. 150000 = Rs 1,500), and `auditLogs` entries `PLAN_*`, `MEMBERSHIP_CREATED`, `MEMBERSHIP_RENEWED`,
   `MEMBER_SUSPENDED`, `MEMBER_REACTIVATED` (no suspension reason text in the audit record).

#### Test coverage

Existing suites were updated for the changed behaviour (duplicate-mobile warning, counter naming the new member, Phase 3 list / profile / dashboard / route screens, the index coverage test).
The dedicated Phase 3 test pass (status / renewal / query-predicate matrices, plan and membership rules suites, assign / renew / suspend integration tests, concurrency) is intentionally deferred to
the final test pass.

### Phase 4: Payments

#### What is new

- **Record a payment** (Admin only; Staff cannot): from the profile (**Record payment**), the Members list (**Payment** row action) or the
  Pending Payments page. The Admin picks the **membership** the money is for (default: the oldest one that still owes; payments are never split
  or allocated automatically). Fields: amount (rupees, at most 2 decimals, above 0), payment date (today or earlier, IST), mode
  (Cash / UPI / Card / Bank Transfer / Other), optional transaction reference and notes. **No card number, expiry or CVV field exists**, and the
  reference / notes / void-reason fields refuse text that looks like a card number (13-19 digits passing the Luhn check; a best-effort client
  guard, PCI-DSS scope is avoided by never storing card data). `createdBy` is the signed-in user, never form input.
- One transaction (TX-4) writes the payment, the membership's paid / outstanding / unpaid, the member's `pendingPaise` and the audit record
  together. An amount above the membership's balance is refused with *"Amount exceeds pending balance (Rs X)"*, checked against the
  freshly read balance inside the transaction, so two admins paying at once can never overpay (the second is refused). A double click or a retry
  after a timeout that actually committed records only one payment (the payment id is generated once per dialog).
- **Void a payment** (Admin, reason required, TX-5): the payment is never deleted or edited. It stays in the history marked **VOID** (with the reason),
  is excluded from every total and from revenue, and the membership's and member's pending amounts are restored in the same commit. A void cannot be
  undone. A wrong void or payment is corrected by voiding and recording again.
- **Optional first payment** on the registration form (Admin, when a plan is chosen) and in the **Assign plan / Renew** dialog: Total Amount (the plan
  price, read-only), **Amount Paid**, a computed **Pending** (display only, never typed or stored), Payment Date, Mode and Reference. Amount Paid 0 or
  blank records no payment and the membership starts unpaid; an amount needs a mode; more than the total is refused. The payment is written in the SAME
  transaction as the membership (and the member, on registration). Staff never see the payment section.
- **Payment history** on the member profile (Admin only): newest first, paginated, voided rows included and clearly marked, no edit or delete control.
  The Membership History table now also shows each membership's derived payment state (Unpaid / Partial / Paid).
- **Payments page** (`/payments`, Admin): all payments across members, newest payment date first, server-side cursor pagination (25 per page),
  filters: paid-from / paid-to (inclusive IST days), payment mode, and Payments vs Voided only.
- **Pending Payments page** (`/payments/pending`, Admin): **a member-level list**, as the architecture specifies (section 5.7): members with
  `pendingPaise > 0` who are not deleted, largest first, with the total from one aggregation; each row opens the record-payment dialog. This
  replaces the requirements' "by membership start date" wording, and "oldest first" is not offered (it would need a per-membership query that includes
  deleted members' memberships).
- **Dashboard**: **Pending payments** (total outstanding + number of members owing), **Revenue this month** (cash basis: payments by payment date in the
  current IST month, voided excluded) and a **Revenue by month** chart (last 12 IST months). All are aggregation queries (`sum` / `count`, one per month, in
  parallel; integer paise); nothing loads a whole collection. They load separately from the member cards, so one failing never blanks the other.
- **Members list**: a **Pending** column (visible to Staff too, read-only) and a **Payment** row action (Admin). The Expiring soon / Expired pages show the
  member's real **Unpaid amount**.

#### What you must deploy (Phase 4 needs new rules AND new indexes)

The Phase 3 rules deny `payments` and refuse any membership / member balance change, so Phase 4 will not work against them.

```bash
npm run deploy:rules     # deploys firestore.rules AND firestore.indexes.json (see section 11 for the project setup)
```

or by hand: **Firestore -> Rules**, paste the whole `firestore.rules`, **Publish**; then create the indexes. New indexes in `firestore.indexes.json` (6):

| Collection | Fields | Used by |
|---|---|---|
| `payments` | `voided`, `paymentDate` desc | Payments page (and its date range) |
| `payments` | `voided`, `method`, `paymentDate` desc | Payments page with a mode filter |
| `payments` | `memberDocId`, `paymentDate` desc | member payment history (voided rows included; this index is not in the architecture list, which only has one with `voided` in the middle) |
| `payments` | `voided`, `paymentDate` asc, `amountPaise` asc | the 12 revenue `sum()` aggregations (the summed field is part of the index; the architecture list has this index without `amountPaise`) |
| `memberships` | `memberDocId`, `unpaid`, `startDate` asc | the record-payment dialog (unpaid memberships, oldest first) |
| `members` | `deleted`, `pendingPaise` desc | Pending Payments list and the dashboard pending `sum` / `count` |

Wait until **Firestore -> Indexes** shows every index as **Enabled** before using the new screens (until then they show *"This view needs a database index that is
still being built..."*, and on the dashboard only the money cards / chart are affected, with a Retry). No new environment variables or Firebase products.
The Firestore emulator does not enforce indexes, so the two aggregation indexes (`amountPaise`, `pendingPaise`) are unverified until deployed: if the dashboard money
cards still error after the indexes are Enabled, use the console link that `npm run dev` prints for the failing query and add the index it asks for to `firestore.indexes.json`.
`tests/unit/indexes.test.ts` checks every payment query plan against the index file.

#### Rules changes worth knowing

- **payments**: Admin only for get / list / create / void; Staff denied; a Member may read only their own (for the future). Payments are immutable: the only update is the
  one-way void (`voided` false -> true with a reason, `voidedAt`, `voidedBy`); delete is denied. Shape, amount (integer paise above 0), method, dates (IST midnight, not in the future),
  `createdAt` = server time and `createdBy` = the caller are validated.
- **Cross-document invariants** (`getAfter`): a payment create must raise the membership's `paidPaise` by exactly its amount, must not exceed the membership's outstanding, and must lower
  the member's `pendingPaise` by exactly its amount, all in the same commit; a void does the reverse. Conversely a membership's paid total and a member's pending total can change ONLY
  together with the payment created / voided in that commit (linked through the commit's audit record), so neither can be edited on its own. A membership created with a first payment must come with
  exactly that payment (id `<membershipId>_first`) in the same commit. A membership's period, plan and amount stay immutable.
- **Phase 3 defect found and fixed while testing Phase 4**: registering a member WITH a plan hit Firestore's limit of 1000 expressions per rule evaluation and was refused (it had never been run against the
  real rules: the seed registers members without a plan). The member-create helpers were rewritten with `let` bindings so it is well under the limit.
- The document-access budget of the heaviest commit (registration + plan + medical notes + first payment) was checked in the emulator, which enforces the 10-per-operation and 20-per-commit limits.

#### Seed data

`npm run seed` now also creates **10 payments** through the same transactions the app uses: full (Rahul, Neha, Arjun, Vikram's renewal), partial (Ravi, Anil, Meera, Sita then completed by a later payment),
one **voided** payment (Anil), a UPI reference, and old unpaid dues that carry forward (Vikram's expired membership). Memberships with no payment: Sam, Samira and Kabir. The seed's
paid / outstanding / pending values reconcile exactly with its payments.

#### Manual smoke test for Phase 4 (about 15 minutes; after the indexes are Enabled)

1. **First payment at registration**: Members -> Register member as Admin, choose a plan: the Payment section shows Total Amount (plan price), Amount Paid, a Pending that updates as you type, Payment Date (today),
   Mode, Reference. Amount 500 with no mode is refused; more than the total is refused; 0 / blank registers with no payment. Save with 500 / UPI: the profile shows pending = price - 500, one payment
   in Payment history, the membership row "Partial". As Staff (if you enable it) the registration form has no payment section.
2. **Renew / assign with a payment**: the dialog has the same section. A renewal with a partial payment adds only the unpaid part to the member's pending amount.
3. **Record a payment**: profile -> **Record payment**. With one unpaid membership it is preselected; with several the oldest is. Try an amount above the balance (message shows the balance), 0, `-5`, `1.234`
   (each refused), a future date (refused), and a 16-digit card-like reference (refused). Pay the rest: the membership shows Paid and pending drops to 0. Double-click Record payment: only one payment exists.
4. **Void**: Void a payment on the profile or on the Payments page with a reason: the row stays, marked VOID with the reason; pending is restored; there is no un-void. A void with an empty reason is refused.
5. **Payments page**: filter by dates and mode (inclusive days); "Voided payments only"; Next / Previous pages (25 per page).
6. **Pending Payments**: the list is largest-first with the total in the subtitle; Record payment from a row; a fully paid member disappears from it.
7. **Dashboard**: Pending payments total and members owing, Revenue this month and the 12-month chart match the payments (a payment dated on the 1st counts in the new IST month; voided ones are excluded). **Refresh** works.
8. **Members list / Expiring / Expired**: the Pending column and Unpaid amount are real; the **Payment** row action opens the dialog.
9. **Firebase console**: `payments` (amounts are integer paise, e.g. 150000 = Rs 1,500), `auditLogs` `PAYMENT_CREATED` / `PAYMENT_VOIDED` with membership id, amount and method only (no reference, notes or void reason),
   and the member's `pendingPaise` equal to the sum of its memberships' `outstandingPaise`.

#### Test coverage

Existing suites were updated for the changed behaviour (registration form payment section, dashboard cards, route table, profile payment history, baseline rules for `payments`, index coverage for the new queries).
The dedicated Phase 4 test pass (money / balance maths, payment validation, the payments and membership rules suites incl. forged commits, record / void / first-payment / concurrency integration tests, UI tests) is intentionally
deferred to the final test pass.

### Phase 5: Attendance

#### What is new

- **Check-in / check-out / mark absent** (Admin and Staff, per the permission matrix). One attendance record per member per IST day, made structural by the
  document id `attendance/{memberDocId}_{YYYYMMDD}`: two staff clicking at once address the same document, one wins, the other is told "already checked in at HH:MM".
  Check-in and check-out times are **server timestamps** (never the device clock); the day is taken from the **server time** in IST (`Asia/Kolkata`, UTC+05:30, no daylight saving), so a check-in at 00:10 IST
  belongs to the new IST day whatever the device's time zone. A check-out must be strictly after the check-in, only once, and only for today's record: a member who forgot to check out yesterday keeps a blank check-out
  shown as "Not recorded", and there is no Check-out button for yesterday's record. An ABSENT record that is followed by an arrival becomes PRESENT (still one record for the day).
- **Membership rules at check-in (NEW-12)**, decided from the member's data read *inside* the transaction (not from what the dialog showed): **Suspended** members are blocked (also refused by the security rules,
  even for a modified client); **Expired** members show a warning and need an explicit "I confirm" tick; **Expiring soon** members show the days remaining; **No membership** members are treated like Expired
  (warning + confirmation: the requirements are silent about them, so this is a choice for you to confirm).
- **Attendance page** (`/attendance`): a member search (the same indexed prefix search as the Members list; nothing is queried until you type, so it stays fast with any number of members), a
  **Check in / out** dialog per member, today's list (All today / Checked in now / Absent, newest check-in first, 25 per page, Refresh to move to a new IST day), a **Check out** button on rows still in the gym, and the counts
  "Currently checked in" and "Present today".
- **Monthly attendance** (`/attendance/monthly`): pick an IST month; per-day PRESENT counts (one `count()` per day up to today) and the month total; per-member days present, with the members listed 25 per page (or found by prefix
  search) and one `count()` per member on screen. No collection is ever loaded in full. Members with no attendance show 0, and a month with no records shows an empty state.
- **Member profile**: a real **Attendance history** section (newest first, cursor pagination, Admin and Staff) with a Check in / out button; **Members list**: an **Attendance** row action for Admin and Staff.
- **Dashboard**: **Today's attendance** (PRESENT records dated today, checked out or not), **Currently checked in** (today's PRESENT records with no check-out; resets at 00:00 IST) and an accessible **Attendance by month** chart
  (PRESENT counts per IST month, last 12), all `count()` aggregations.
- **Audit**: no audit records are written for attendance: the audit list in the requirements (FR-13) does not include it, and attendance rows already carry `createdBy` / `updatedBy` and server times.
- **Staff can use it, but Staff login is still off.** The screens and rules are role-aware (Staff sees Attendance, the history and the Attendance row action; nothing financial), but the app still admits ADMIN accounts only, exactly as in
  Phases 2 to 4. Enable Staff with the one-line change in `src/constants/roles.ts` (`APP_ALLOWED_ROLES`) when you want the front desk to use it; the Dashboard is Admin-only in the navigation.
- Past-day attendance cannot be created or edited from the app, not even by an Admin (no backdating: the day comes from the server clock). The rules allow an Admin to delete a record, but there is no button for it in Phase 5.

#### What you must deploy (Phase 5 needs new rules AND new indexes)

The Phase 4 rules deny `attendance`, so Phase 5 will not work against them.

```bash
npm run deploy:rules     # deploys firestore.rules AND firestore.indexes.json (see section 11 for the project setup)
```

or by hand: **Firestore -> Rules**, paste the whole `firestore.rules`, **Publish**; then create the indexes. New indexes in `firestore.indexes.json` (5, all on `attendance`):

| Fields | Used by |
|---|---|
| `date`, `checkInAt` desc | Attendance page: all of today's records |
| `date`, `status`, `checkedOut`, `checkInAt` desc | Attendance page: "Checked in now" |
| `memberDocId`, `date` desc | member attendance history |
| `status`, `date` | dashboard chart (12 monthly `count()`s) |
| `memberDocId`, `status`, `date` | Monthly report: days present per member |

These differ from the architecture's list, which had `date, status, checkInAt`, `date, status, checkedOut` and `memberDocId, date` / `status, date`: the list above is exactly what the code queries (`tests/unit/indexes.test.ts` checks every attendance query
plan against the file). Today's Present count, Currently checked in, the per-day report counts and the Absent filter are equality-only queries and need no composite index.
Wait until **Firestore -> Indexes** shows every index as **Enabled** before using the new screens (until then they show *"This view needs a database index that is still being built..."*). The emulator does not enforce indexes, so they are
unverified until deployed. No new environment variables or Firebase products.

#### Rules changes worth knowing

- **attendance**: get / list for Admin and Staff (a Member may read only their own, for the future); create and update for Admin and Staff only; delete Admin only. The record id must equal `{memberDocId}_{dateKey}`, and `dateKey` / `date` must be
  **today's IST day computed from the server time** (`request.time` + 5h30). `checkInAt` / `checkOutAt` must equal `request.time`. The only updates are check-out (PRESENT, not yet out, today's record, `checkOutAt` strictly after `checkInAt`) and
  ABSENT -> PRESENT; identity, snapshot and date fields are frozen. A create or a check-in needs a live member whose `memberId` / name match the snapshot, and a **suspended member cannot be checked in** (marking a suspended member absent is allowed).
- The heaviest attendance write (a check-in create, which reads the member once) was run in the emulator with the real rules, well under the expression and document-access limits. Each attendance write costs one member read in the rules.
- If a device clock is a day off, or the day changes between the click and the commit, the rules refuse the write and the app says so ("The date changed..." / "clock is wrong") instead of filing it under the wrong day.

#### Seed data

`npm run seed` now also creates attendance: about 350 past-day records over the last 75 days (some ABSENT marks, some forgotten check-outs), written with the security rules disabled because the rules deliberately allow no
backdating (emulator only, in exactly the shape the app writes); and today's records through the **real** check-in / check-out / absent transactions as the seeded Staff user under the real rules: Rahul, Sam, Ravi and Samira (an Expired member, after a refused
attempt without confirmation) are still **in**, Sita and Arjun checked in and **out**, Meera is marked **absent**, and Neha (Suspended) is refused both by the service and by the rules for a modified client. The seed prints these outcomes.

#### Manual smoke test for Phase 5 (about 15 minutes; after the indexes are Enabled)

1. **Attendance page** (as Admin; as Staff once enabled): type `rah` in Find a member: Rahul appears; nothing is listed with an empty box. Click **Check in / out** on a member with an active membership: Check in works, the list gains a row with the time,
   "Currently checked in" goes up. Opening the dialog again shows "Checked in at HH:MM" and a Check out button; **Check out** sets the time, then the dialog shows both times and no actions.
2. **Duplicates**: check the same member in from two browser tabs: the second says "already checked in today at HH:MM"; only one record exists in the console (`attendance/{memberDocId}_{YYYYMMDD}`).
3. **NEW-12**: an Expired member (Samira) shows a warning and the Check in button stays disabled until the confirm box is ticked; a Suspended member (Neha) shows a red "suspended" message and no Check in button; an Expiring-soon member (Sita, Sam) shows the days left.
4. **Mark absent**: on a member with no record today, **Mark absent**: the row shows Absent (filter "Absent"); check them in afterwards: the same row becomes Present. Once a record exists the dialog offers no Mark absent (and the service refuses it).
5. **Filters and paging**: All today / Checked in now / Absent; Refresh; Next / Previous when there are more than 25.
6. **Members list**: the **Attendance** action opens the same dialog. **Profile**: Attendance history lists newest first; a past day with no check-out reads "Not recorded"; a member with no records shows an empty state.
7. **Monthly attendance**: pick this month and last month: the day counts and the total match the records; a future month is not selectable; the per-member table pages 25 at a time and the search narrows it.
8. **Dashboard**: Today's attendance = present records dated today (including checked-out ones); Currently checked in = those with no check-out; the chart shows the last 12 months. **Refresh** works. A member who forgot to check out yesterday is not counted as currently in.
9. **Around midnight IST** (optional): a check-in at 00:10 IST is dated the new IST day; leave the Attendance page open past midnight and press Refresh: it switches to the new day.
10. **Firebase console**: `attendance` documents have `date` at 00:00 IST, `dateKey`, `checkInAt` / `checkOutAt` timestamps, `checkedOut`, and no audit record exists for them.

#### Known limits

- Attendance records carry no `deleted` flag, so a member soft-deleted mid-day can still be counted in *today's* figures (R-10, accepted; nothing is fanned out on soft delete). Deleted members cannot be found or checked in.
- The monthly per-member table lists every member (including 0 days) page by page, because Firestore cannot sort or filter members by an aggregated figure; the Reports phase adds the date-range attendance report and CSV.
- Device clocks: the write path uses the server clock, but "today" on screen (which list to show, which day the Refresh moves to) is the device's IST day, like every other screen.

#### Test coverage

Existing suites were updated for the changed behaviour (baseline rules for `attendance`, the dashboard cards and chart, the route table, the profile's attendance history, the members list's Attendance action for Staff, index coverage for the attendance queries).
The dedicated Phase 5 test pass (attendance domain rules, the attendance rules suite incl. forged and out-of-day writes, check-in / check-out / absent / concurrency integration tests, the IST-boundary and month-boundary tests, UI tests) is intentionally deferred to the final test pass.

### Phase 6: Reports and CSV export

#### What is new

- **Reports page** (`/reports`, **Admin only**: the route is `allow: ['ADMIN']` and hidden from the sidebar for anyone else; the CSV audit record is also Admin-only in the rules). Six tabs; the selected one is in `?report=` so it can be bookmarked. Every report has the same layout: date filters, totals, a paginated table (25 rows per page, cursor pagination, no offsets, no full-collection load) and **Export CSV**.

| Report | Date filter applies to | Rows | Totals above the table |
|---|---|---|---|
| **Members** | joining date | every non-deleted member, oldest joiner first: ID, name, mobile, email, gender, joining date, plan, membership start / end, status, amount pending | number of members |
| **Expired memberships** | end date (always before today) | the Expired page's predicate: latest end date in range, not suspended, most recently expired first: previous plan and amount, start, expiry, days since expiry, pending | number of members |
| **Expiring memberships** | end date (today or later) | the Expiring page's predicate, soonest first; defaults to today .. +7 days, with quick windows (1 / 3 / 7 / 15 / 30 days) | number of members |
| **Revenue** | payment date (IST), cash basis | non-voided payments, newest first: date, member, mode, transaction reference, amount | total, **by payment mode**, and **per day** (range up to 31 days) or **per IST month** (up to 36 months); both dates must be set for the breakdown |
| **Attendance** | attendance date | records, oldest day first, All / Present only / Absent only: date, member, status, check-in, check-out (a PRESENT record with no check-out reads "Not recorded") | Present and Absent records in the range |
| **Pending payments** | **joining** date (optional) | members who owe money (not deleted), largest first: ID, name, mobile, status, expiry, joining date, amount pending | total pending and members owing |

- **Filters follow the requirements** (US-6.1): both ends are inclusive whole IST days; an end date before the start date is rejected ("Check the dates", no query, export disabled); a range that cannot match (e.g. Expired starting today) shows an empty state without querying.
  Expired and Expiring intersect your range with "before today" / "today or later", so they always agree with the Expired page, the Expiring page and the dashboard (US-6.1e).
- **Money**: stored and summed as integer paise (Firestore `sum()` of integers); formatted to rupees only at the edge: `₹1,500.00` on screen, `1500.00` (plain number, 2 decimals) in the CSV.
- **CSV export** (same filters and columns as the table, US-6.2a):
  - **UTF-8 with a BOM**, so Excel opens `₹` and Indian-script names correctly; **RFC 4180** quoting (commas, quotes, line breaks; CRLF records); dates `DD/MM/YYYY` (IST); money as plain rupees with 2 decimals.
  - **Formula-injection neutralization**: a text cell starting with `=` `+` `-` `@` (also after leading spaces) or with a tab / CR / LF gets a leading `'`, so a name like `=HYPERLINK(...)` is shown as text. Numbers the app generates are never altered.
  - **Never included**: medical notes (they live in `memberMedical`, which no report reads), photos, consent details, date of birth, address, emergency contact, general notes, the suspension reason, a payment's free-text notes, and voided payments (with their reasons) altogether.
  - **Paged fetch, progress, cancel, cap** (see "How the cap works").
  - **Downloads inside the app, no server**: a Blob + a temporary `<a download>` click.
  - **Audit**: every completed export writes a `REPORT_EXPORTED` record (who, which report, the filters as dates, row count, truncated flag, the cap) with no personal values. The record is written **before** the file is released: if it cannot be written the export fails and no file is produced.
- **Not built**: scheduled or emailed reports, PDF, and a per-day attendance summary (the monthly attendance page already has it).

#### How the cap works

- One export reads **at most `EXPORT_MAX_ROWS` = 5,000 rows** (`src/domain/reports.ts`), in pages of `EXPORT_PAGE_SIZE` = 250 (20 page reads at most; each page also reads one extra document to know whether more rows exist). Each row is a billed document read, so a full 5,000-row export costs about 5,020 reads plus the audit write: it is the only place the app reads that many at once.
- If more rows match than the cap, the file holds the first 5,000 (in the table's order), the on-screen message says so ("Only the first 5,000 rows were exported ... narrow the date range and export again"), the audit record has `truncated: true`, and the file name ends in `-first-5000-rows` so a partial file cannot pass as complete. The check is exact: exactly 5,000 matching rows is *not* truncated (the reader asks for one row more than the cap allows before deciding).
- **Cancel** stops between pages and discards everything: no file, no audit record. A failure at any point (network, permission, index) does the same and shows a friendly message: never a partial file (US-6.2f). Changing a filter while an export runs also cancels it.
- To export more than 5,000 rows, split the range (e.g. by month) and export each part. To change the cap, edit `EXPORT_MAX_ROWS` (and `rowCap <= 100000` in the rules if you go above that).

#### What you must deploy (Phase 6 needs new indexes AND a small rules change)

```bash
npm run deploy:rules     # deploys firestore.rules AND firestore.indexes.json (see section 11 for the project setup)
```

or by hand: **Firestore -> Rules**, paste the whole `firestore.rules`, **Publish**; then create the indexes. Nothing else: no new collections, environment variables or Firebase products.

- **Rules** (auditLogs only): a `REPORT_EXPORTED` record must be created by an **Admin**, with entity `report` (and only that action may use entity `report`), and its metadata may only hold `report`, `from`, `to`, `status` (attendance), `rowCount`, `truncated`, `rowCap` with the right types (dates as `DD/MM/YYYY` or `any`): a name, mobile or amount cannot be smuggled into the audit log. Every other audit write is unchanged.
- **New indexes** (2; everything else reuses the Phase 2 to 5 indexes: the Members report uses `members deleted + joiningDate`, Expired / Expiring the `membership.endDate` indexes, the Revenue rows `payments voided + paymentDate desc` and its totals `voided + paymentDate + amountPaise`, Attendance `status + date` or the automatic `date` index):

| Collection | Fields | Used by |
|---|---|---|
| `payments` | `voided`, `method`, `paymentDate` asc, `amountPaise` asc | Revenue report: the total per payment mode (5 `sum()` aggregations) |
| `members` | `deleted`, `pendingPaise` desc, `joiningDate` asc | Pending payments report when a joining-date range is set (a two-inequality query: `pendingPaise >= 1` and a `joiningDate` range) and its totals |

  Wait until **Firestore -> Indexes** shows both as **Enabled**; until then those two views show *"This view needs a database index that is still being built..."* with a Retry, and the other reports work. The emulator does not enforce indexes, so these two are **unverified against real Firestore**: they were checked against the exact queries the SDK builds, but if a report still errors once they are Enabled, `npm run dev` prints the console link for the failing query in the browser console; add the index it asks for to `firestore.indexes.json`.
  The Pending report *without* dates, and every other report, only use indexes that already existed.

#### Deviations from the requirements / architecture

- **Pending payments filter**: the requirements say *membership start date*; the architecture (section 5.7, open question 1) replaces it with the member's **joining date** because a membership-level query would include soft-deleted members' memberships unless a "deleted" flag were copied onto every membership on soft delete. Built as the architecture says. It needs the second new index above (a two-inequality query, supported by the Firestore SDK used here).
- **Attendance and Revenue rows are oldest-day-first / newest-first respectively** (Attendance ascending so it reuses the existing `status + date` index instead of adding a descending twin; Revenue newest first like the Payments page). Within one day the order is stable but not meaningful (document id).
- **Attendance rows include members who were soft-deleted after the record was written** (attendance carries no `deleted` flag, R-10, unchanged from Phase 5).
- **A report cannot be exported with an empty or inverted range**; the cap is 5,000 rows as the architecture suggests.

#### Manual smoke test for Phase 6 (about 15 minutes; after the two indexes are Enabled; seed data loaded)

1. Sign in as Admin, open **Reports**: six tabs. As Staff (once enabled) the entry is not in the sidebar and `/reports` shows access denied.
2. **Members**: 12 rows on the seed; set *Joined from* to a recent date: fewer rows, the count above the table matches; set *Joined to* before *Joined from*: "Check the dates", export disabled.
3. **Expired / Expiring**: the rows match the Expired page and the Expiring soon page (same window); Expiring defaults to today .. +7 days, *Quick window* changes it; a range that cannot match (Expired from today) shows "Nothing in this range".
4. **Revenue**: this month by default: total, by payment mode (all five modes, zeros included) and per day; the voided seed payment (Anil, 500) is not in any figure; clear *Paid from* and the breakdown asks for both dates; a 3-month range groups per month.
5. **Attendance**: Present only / Absent only change the rows and keep the two totals for the range; oldest day first.
6. **Pending payments**: largest first; set *Joined to* 100 days ago: only the older members remain, and the total and count above match.
7. **Export**: click **Export CSV** on each report: a `hercules-<report>-<yyyymmdd>.csv` downloads. Open it in Excel: `₹` in the header and any Hindi name display correctly, dates are `DD/MM/YYYY`, money is a number with 2 decimals. In the console: `auditLogs` has a `REPORT_EXPORTED` record per export (report, dates, rowCount, truncated) and no names or amounts.
8. **Injection**: rename a member to `=1+1` (or `+91 1`, `-x`, `@x`) in the app, export Members: the cell shows the text with a leading `'`, not a result.
9. **Cap** (optional): temporarily set `EXPORT_MAX_ROWS` to 5 in `src/domain/reports.ts`, export Members: the file has 5 rows, the warning appears, the name ends `-first-5-rows`, the audit record says `truncated: true`. **Cancel** during a larger export: "Export cancelled. No file was created.", no audit record.
10. **No medical data**: search the CSVs for the seed member Anil's medical note ("asthma"): not present, and none of the six reports shows an address, date of birth or emergency contact.

#### Known limits

- The row cap is per export (5,000); the on-screen tables page 25 at a time without a total row count (one `count()` is shown as "matching rows" where cheap).
- "Today" and the default filters are the device's IST day (like every screen); the export date in the file name is the device date.
- A Staff account can still read `members` / `attendance` through the Firestore SDK (the matrix lets Staff view members and attendance): the Reports **page** and the export **audit** are Admin-only, but a modified Staff client could read rows without the audit trail. Documented risk R-1; the rules cannot audit reads.
- Reports read the whole matching set in pages: a very large gym should export by month.

#### Test coverage

Existing suites were updated for the changed behaviour (the route table now renders the real Reports screen, index coverage extended to every report query and total). The dedicated Phase 6 test pass (CSV encoder and injection cases, the export loop's cap / cancel / no-partial-file rules, report row mappers and privacy allow-list, filter and range rules, revenue bucketing, the audit rules for `REPORT_EXPORTED`, UI tests for the Reports page) is intentionally deferred to the final test pass. Before that pass the behaviour was proven with throwaway scripts against the Firestore emulator (seed data, real rules), not committed.

### Phase 7: Notifications abstraction and Settings

#### What is new

- **Notification abstraction** (FR-11, US-7.1, US-7.2). Nothing is sent, and nothing writes notification records (NEW-21).
  - `src/types/notification.ts`: `NotificationRequest`, `NotificationRecord` and the provider-agnostic `NotificationService` interface (`send`, `queue`). It is Firebase-free like the rest of `src/types`.
  - `src/constants/enums.ts`: `NotificationChannel` (`WHATSAPP`, `SMS`, `EMAIL`, `PUSH`), `NotificationType` (`MEMBERSHIP_EXPIRING`, `MEMBERSHIP_EXPIRED`, `PAYMENT_DUE`) and `NotificationStatus` (`QUEUED`, `SENT`, `FAILED`, `NOT_DELIVERED`).
  - `src/domain/notificationTemplates.ts`: pure message templates. A message holds the member's **first name** and dates as `DD/MM/YYYY` (IST) and nothing else (no full name, mobile, amount, plan or medical data). Line breaks and other control characters in a name are removed; a blank name becomes "Member".
  - `src/services/notificationService.ts`: the **stub** provider and the one place to get the service, `getNotificationService()`. The stub renders the message, returns an **in-memory** record with status **`NOT_DELIVERED`** and the detail "Not delivered (stub): no notification provider is configured...", and never reports `SENT` or `QUEUED`. It stores nothing and logs nothing (a message contains a first name, so it is not written to the console either).
  - A record holds the member's **document id** (a reference), type, channel, status, the rendered message, a small payload (`firstName`, `endDate`), created-at, sent-at, a status detail and the provider name. It never holds a mobile number, email, medical data or an amount: a real provider looks the recipient address up from the member document at delivery time.
- **Settings page** (`/settings`, Admin only) is now a real, **read-only** page: gym name, time zone, date format, currency, the fixed membership rules (the 7-day Expiring soon window, the CSV export cap) and the notification status (provider "stub", every channel "not configured"). It reads no database, writes nothing and needs no rule.

#### Deviations from the requirements / architecture

- **Settings is read-only, not editable.** FR-15 / NEW-2 say Settings is a placeholder in the MVP and list **no editable setting**; the architecture sketches a `settings/app` document but names no fields. Inventing fields would be guessing, so no `settings/*` document, write path, audit action or seed exists. If you want editable settings (e.g. gym name on the sidebar), tell me which fields; that adds a Zod-validated Admin-only `settings/app` document, a rule and an audit event.
- **The 7-day Expiring soon window is deliberately not editable.** It is baked into `calculateMembershipStatus`, the query predicates (date ranges), the Expiring page and its report window, the dashboard cards and the members list filters (D-4, `EXPIRING_SOON_MAX_DAYS`). Making it a setting would change status logic everywhere and every test that pins the D-4 boundary table.
- **`notifications` stays denied to every client** in `firestore.rules` (the architecture sketch has an Admin read rule, but with no writer and no reader there is nothing to read). Only the comments in `firestore.rules` changed, so **no rules deployment is needed**. Add `allow read: if isAdmin(); allow write: if false;` (or a shaped create rule) only when a real writer or a history screen exists.
- `NotificationRecord` fields beyond the requirement's list (member, type, channel, status, created-at, payload) are `message`, `sentAt`, `statusDetail`, `provider` and a nullable `id`.

#### How to add a real provider later

1. **Choose the delivery route.** WhatsApp Business API, SMS gateways and email services need a secret key or a paid account, so they must not run in the browser (the key would ship to every visitor). FCM push needs a service worker plus a server that holds the send credential. Every option therefore needs a **server**: there is none on this plan (no Cloud Functions, see Firebase Blaze). The realistic options are:
   - **A Render Cron Job** (paid) running a small Node script with the Firebase **Admin SDK** and the provider's SDK, secrets in Render environment variables; or
   - **Firebase Blaze + a scheduled Cloud Function**, the same code in a function.
2. **Implement the interface.** Write a class/factory that satisfies `NotificationService` (`send`, `queue`), rendering with `renderNotificationMessage` (or a provider-approved template: WhatsApp requires pre-approved templates, so map `NotificationType` to the template id). It must return `SENT` only when the provider accepted the message, `FAILED` with a detail otherwise, and must look the recipient address up itself. Register it once with `setNotificationService(provider)` at start-up (server-side code would import the same `domain` and `types` modules).
3. **Deferred scheduled processing.** Nothing in the MVP runs on a schedule. Membership status is computed live from the dates (D-5 in the architecture: no daily mass status updates), so *"who is expiring in 7 days"* is always a query (the Expiring soon page, and the same predicate used by its report). A cron job would run that same predicate once a day, create `notifications` records idempotently (a deterministic document id such as `{memberDocId}_{type}_{endDate}` so a re-run cannot duplicate), and hand them to the provider. This is out of scope for the MVP (FR-12, US-7.3, AC 18 are parked).
4. **Before switching it on** (compliance): confirm the member consented to be *messaged* (the current consent text covers administering the membership, not marketing or reminders over WhatsApp/SMS; wording needs legal review, DPDP purpose limitation), keep the member's phone number out of notification records, and never put medical data, amounts or a full name in a message. Under-18 members' reminders should go to the guardian.
5. **Rules and UI.** Open `notifications` in `firestore.rules` for exactly the writer you add (an Admin-only read for a history screen; the cron uses the Admin SDK and bypasses rules) and add tests for it. Any new "send reminder" button is a product decision (NEW-21 says none in the MVP).

#### What you must deploy

Nothing. No rules, indexes, collections, environment variables or Firebase products change in Phase 7 (only comments in `firestore.rules`). Redeploy the static site on Render as usual.

#### Manual smoke test for Phase 7 (about 3 minutes)

1. Sign in as Admin. **Settings** is in the sidebar and opens a page with three sections: Gym, Membership rules (fixed), Notifications. There is no Save button and no editable field.
2. Membership rules shows **7 days** for the Expiring soon window with the explanation, and the CSV export limit **5,000 rows per export**.
3. Notifications shows the info banner "Reminders are not sent...", provider `stub (nothing is delivered)` and the four channels, each "not configured".
4. In the Firebase console after using the app: there is **no `notifications` or `settings` collection**. In the emulator/console rules playground, an Admin read of `notifications/x` or `settings/app` is denied.
5. `/settings` as a Staff user (once Staff is enabled) shows access denied.

#### Test coverage

Existing suites were updated for the changed behaviour (the route table now renders the real Settings screen instead of the placeholder; the baseline rules test's comments say `notifications` and `settings` stay denied). The dedicated Phase 7 test pass (stub returns `NOT_DELIVERED` for both `send` and `queue` and never `SENT`, template rendering and first-name / date / control-character rules and no personal data beyond them, `getNotificationService` / `setNotificationService` swap and restore, the Settings page content and its read-only behaviour, `notifications` / `settings` rules denial for Admin, Staff and Member) is intentionally deferred to the final test pass. The stub and templates were checked with a throwaway script (not committed).
