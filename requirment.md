You are a senior full-stack developer specializing in React, Firebase, and modern SaaS applications.

I want you to build a complete Gym Management System for a gym owner.

TECHNOLOGY STACK
----------------
Frontend:
- React 18+
- TypeScript
- Vite
- Material UI (MUI)
- React Router
- Firebase SDK

Backend / Cloud:
- Firebase Authentication
- Cloud Firestore
- Firebase Storage
- Firebase Cloud Functions where required

Hosting:
- Firebase Hosting

Do NOT create a separate Java/Spring Boot backend.
Firebase will be used as the backend.

APPLICATION NAME
----------------
Gym Management System

MAIN OBJECTIVE
--------------
The application should allow a gym owner/admin to:

1. Register gym members
2. Maintain member profiles
3. Create/manage membership plans
4. Assign a membership plan to a member
5. Track membership start and expiry dates
6. Easily identify:
   - Active memberships
   - Memberships expiring soon
   - Expired memberships
7. Track payments
8. Maintain member attendance
9. Search and filter members
10. Provide a dashboard with important gym statistics

USER ROLES
----------
Initially support:

1. ADMIN / GYM OWNER
   - Full access
   - Manage members
   - Manage plans
   - Manage payments
   - View reports
   - Manage attendance

2. STAFF
   - View members
   - Register members
   - Mark attendance
   - View membership status
   - Limited administrative access

3. MEMBER
   - Login
   - View own profile
   - View membership details
   - View expiry date
   - View payment history
   - View attendance history

For the first MVP, implement ADMIN functionality first.
Keep the architecture ready for STAFF and MEMBER roles.

AUTHENTICATION
--------------
Use Firebase Authentication.

Support:
- Email/password login
- Logout
- Forgot password
- Protected routes
- Role-based access

Create an authenticated admin dashboard.

MEMBER REGISTRATION
-------------------
Create a "Register Member" form.

Fields:

Personal Information:
- Member ID (auto-generated)
- First Name
- Last Name
- Gender
- Date of Birth
- Mobile Number
- Email
- Address
- Emergency Contact Name
- Emergency Contact Number
- Profile Photo

Gym Information:
- Membership Plan
- Membership Start Date
- Membership End Date
- Membership Status
- Trainer
- Joining Date

Payment Information:
- Total Amount
- Amount Paid
- Pending Amount
- Payment Date
- Payment Mode
- Transaction Reference

Additional:
- Medical Notes
- General Notes

Member ID should be automatically generated, for example:

GYM-2026-0001
GYM-2026-0002
GYM-2026-0003

Do not rely only on the frontend to generate unique IDs.
Use a Firestore-safe mechanism to avoid duplicate IDs.

MEMBERSHIP PLANS
----------------
Create a Membership Plans module.

Example plans:

- Monthly
- Quarterly
- Half-Yearly
- Yearly

Each plan should contain:

- Plan ID
- Plan Name
- Duration in days/months
- Price
- Description
- Active/Inactive
- Created Date
- Updated Date

Admin should be able to:

- Create plan
- Edit plan
- Activate/deactivate plan
- Delete plan only when safe

MEMBERSHIP EXPIRY MANAGEMENT
----------------------------
This is one of the most important features.

Calculate membership status based on the membership end date.

Statuses:

ACTIVE
EXPIRING_SOON
EXPIRED
SUSPENDED

Rules:

ACTIVE:
End date is more than 7 days away.

EXPIRING_SOON:
End date is within the next 7 days.

EXPIRED:
End date is before today's date.

SUSPENDED:
Membership has been manually suspended by admin.

The dashboard should clearly show:

Total Members
Active Members
Expiring in 7 Days
Expired Members
Today's Attendance
Pending Payments
Monthly Revenue

MEMBERS PAGE
------------
Create a professional members table.

Columns:

- Member ID
- Name
- Mobile
- Membership Plan
- Start Date
- End Date
- Status
- Amount Pending
- Actions

Actions:

- View
- Edit
- Renew
- Payment
- Attendance
- Suspend
- Delete

Provide:

- Search by name
- Search by mobile
- Search by Member ID
- Filter by membership status
- Filter by membership plan
- Filter by expiry date
- Sort by expiry date

EXPIRING MEMBERS
----------------
Create a dedicated page:

"Memberships Expiring Soon"

Show members whose membership expires within:

- 1 day
- 3 days
- 7 days
- 15 days

Allow admin to select the expiry window.

Display:

Member Name
Mobile Number
Plan
Expiry Date
Days Remaining
Pending Amount
Renew button

EXPIRED MEMBERS
---------------
Create a dedicated page showing all expired memberships.

Display:

Member
Mobile
Previous Plan
Expired Date
Days Since Expiry
Previous Amount
Renew button

RENEW MEMBERSHIP
----------------
Admin should be able to renew an existing member.

Example:

Current membership:
01 Sep 2026 → 30 Sep 2026

Renew for 1 month.

New membership:
01 Oct 2026 → 31 Oct 2026

If the member renews before expiry, extend from the existing expiry date.

If the membership has already expired, start the new membership from today's date.

Store every renewal as a separate membership/payment transaction.

Do NOT overwrite historical membership records.

PAYMENT MANAGEMENT
------------------
Create payment tracking.

Each payment should contain:

- Payment ID
- Member ID
- Membership ID
- Amount
- Payment Date
- Payment Method
- Transaction Reference
- Notes
- Created By

Payment methods:

- Cash
- UPI
- Card
- Bank Transfer
- Other

Support:

- Full payment
- Partial payment
- Pending payment

Automatically calculate:

Total Membership Amount
Total Paid
Outstanding Amount

ATTENDANCE
----------
Create an attendance module.

Admin/staff should be able to mark attendance.

Fields:

- Member ID
- Member Name
- Date
- Check-in Time
- Check-out Time
- Status

Status:

PRESENT
ABSENT

Provide:

- Today's attendance
- Member attendance history
- Monthly attendance report

Dashboard should show:

Today's total attendance
Currently checked-in members

DASHBOARD
---------
Create a modern responsive admin dashboard.

Cards:

1. Total Members
2. Active Members
3. Expiring Soon
4. Expired Members
5. Today's Attendance
6. Pending Payments
7. Current Month Revenue

Charts:

- New members by month
- Revenue by month
- Attendance by month
- Membership plan distribution

Also show a table:

"Memberships Expiring Soon"

Show the next 10 members whose memberships are expiring.

MEMBER PROFILE
--------------
Create a detailed member profile page.

Sections:

Profile
Membership
Payment History
Attendance History
Membership History
Notes

Show a prominent membership status:

ACTIVE
EXPIRING SOON
EXPIRED
SUSPENDED

Also display:

Start Date
Expiry Date
Days Remaining

FIRESTORE DATABASE DESIGN
-------------------------
Use a scalable Firestore structure.

Suggested collections:

users
members
membershipPlans
memberships
payments
attendance
trainers
settings

Example member document:

members/{memberId}

{
  "memberId": "GYM-2026-0001",
  "firstName": "Rahul",
  "lastName": "Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "gender": "MALE",
  "dateOfBirth": "...",
  "address": "...",
  "emergencyContact": {
      "name": "...",
      "mobile": "..."
  },
  "profilePhotoUrl": "...",
  "status": "ACTIVE",
  "joiningDate": "...",
  "createdAt": "...",
  "updatedAt": "..."
}

Example membership:

memberships/{membershipId}

{
  "memberId": "...",
  "planId": "...",
  "startDate": "...",
  "endDate": "...",
  "amount": 1500,
  "status": "ACTIVE",
  "createdAt": "...",
  "updatedAt": "..."
}

Example payment:

payments/{paymentId}

{
  "memberId": "...",
  "membershipId": "...",
  "amount": 1500,
  "paymentMethod": "UPI",
  "paymentDate": "...",
  "transactionReference": "...",
  "createdAt": "..."
}

IMPORTANT FIREBASE RULES
------------------------
Security is very important.

Implement Firestore Security Rules.

Requirements:

- Unauthenticated users cannot access application data.
- Admin has full access.
- Staff has limited access.
- Members can only read their own information.
- Members cannot modify payment records.
- Members cannot modify membership expiry dates.
- Validate user roles using Firebase Authentication/custom claims or secure user documents.
- Never trust role information supplied directly by the frontend.

FIREBASE STORAGE
----------------
Use Firebase Storage for member profile photos.

Requirements:

- Compress images before upload if practical.
- Validate file type.
- Limit file size.
- Store only the Firebase Storage URL/reference in Firestore.

DATE AND TIME
-------------
Use Firebase Timestamp / Firestore Timestamp.

Do NOT store important dates only as formatted strings.

Use Indian timezone:

Asia/Kolkata

Display dates as:

DD/MM/YYYY

Example:

19/09/2026

DAYS REMAINING
--------------
Create a reusable utility:

calculateMembershipStatus(startDate, endDate)

Return:

{
  status,
  daysRemaining
}

Example:

{
  status: "EXPIRING_SOON",
  daysRemaining: 5
}

Avoid timezone bugs.

UI/UX
-----
Create a professional gym-management dashboard.

Design:

- Clean modern UI
- Responsive
- Desktop-first but mobile friendly
- Sidebar navigation
- Top navigation bar
- Cards
- Tables
- Dialogs
- Forms
- Toast notifications
- Loading states
- Empty states
- Error states
- Confirmation dialogs

Sidebar:

Dashboard
Members
Membership Plans
Payments
Attendance
Trainers
Reports
Settings

Use Material UI.

PROJECT STRUCTURE
-----------------
Use a clean architecture.

Example:

src/
  components/
  pages/
  layouts/
  routes/
  services/
  firebase/
  hooks/
  context/
  utils/
  types/
  constants/
  theme/

Separate:

- UI components
- Firebase services
- Business logic
- Types/interfaces
- Utility functions

Do not put all Firebase code directly inside React components.

FIREBASE SERVICES
-----------------
Create reusable services such as:

memberService.ts
membershipService.ts
paymentService.ts
attendanceService.ts
planService.ts
userService.ts

Use TypeScript interfaces/types.

ERROR HANDLING
--------------
Implement proper error handling.

Handle:

- Firebase unavailable
- Permission denied
- Invalid data
- Duplicate member
- Payment failure
- Image upload failure
- Network error

Show user-friendly error messages.

VALIDATION
----------
Use React Hook Form + Zod if appropriate.

Validate:

- Required fields
- Mobile number
- Email
- Dates
- Payment amount
- Membership plan
- Emergency contact

Do not allow:

- End date before start date
- Negative payment
- Invalid mobile number
- Invalid email

SEARCH/PAGINATION
-----------------
Firestore data can grow significantly.

Do not load all members at once.

Implement:

- Pagination
- Server-side Firestore queries where possible
- Search/filter strategy compatible with Firestore limitations

Explain any Firestore indexing requirements.

REPORTS
-------
Create reports:

1. Member report
2. Expired membership report
3. Expiring membership report
4. Revenue report
5. Attendance report
6. Payment pending report

Allow date filters.

Where practical, provide CSV export.

NOTIFICATIONS
-------------
Design the application so future notifications can be added.

Future support:

- WhatsApp membership expiry reminder
- SMS
- Email
- Push notification

For the MVP, create a notification service abstraction but do not require an external WhatsApp/SMS provider.

AUTOMATIC EXPIRY PROCESS
------------------------
Membership status should not depend only on an admin opening the application.

Create a mechanism using Firebase Cloud Functions / scheduled functions where appropriate.

For example:

Every day:

- Find memberships expiring within 7 days
- Mark/identify them as EXPIRING_SOON
- Identify expired memberships
- Optionally create notification records

However, avoid unnecessary writes.

Prefer calculating status dynamically where appropriate and explain the tradeoff.

AUDIT LOG
---------
Create an audit log for important actions:

- Member created
- Member updated
- Membership created
- Membership renewed
- Payment created
- Membership suspended
- Member deleted

Store:

- User
- Action
- Entity
- Entity ID
- Timestamp
- Important metadata

SECURITY
--------
Follow Firebase security best practices.

Never expose:

- Firebase Admin SDK credentials
- Service account private keys
- Secret API keys

Use environment variables for client configuration.

Create:

.env.example

Do not commit .env files.

TESTING
-------
Add tests for important business logic.

Especially test:

- Membership expiry calculation
- Expiring soon calculation
- Renewal calculation
- Payment balance calculation
- Validation
- Role permissions

SEED DATA
---------
Create a development seed mechanism containing:

5 members
3 membership plans
10 payments
Attendance records
1 admin user setup instruction

README
------
Create a detailed README.md containing:

1. Project overview
2. Features
3. Architecture
4. Prerequisites
5. Firebase project creation
6. Firebase Authentication setup
7. Firestore setup
8. Firebase Storage setup
9. Environment variables
10. Local development
11. Firebase deployment
12. Firestore indexes
13. Security rules
14. Cloud Functions deployment
15. Production checklist

IMPORTANT DEVELOPMENT RULE
--------------------------
Do not generate the entire project blindly in one huge response.

First create:

1. Project architecture
2. Database schema
3. Firestore security strategy
4. Authentication strategy
5. Screen list
6. Component structure
7. Development roadmap

Then implement the project module by module.

IMPLEMENTATION ORDER
--------------------

Phase 1:
- React + Vite + TypeScript
- Material UI
- Firebase configuration
- Authentication
- Admin login
- Protected routes
- Layout

Phase 2:
- Dashboard
- Members
- Member registration
- Member profile
- Search/filter

Phase 3:
- Membership plans
- Membership assignment
- Expiry calculation
- Expiring members
- Expired members
- Renewal

Phase 4:
- Payments
- Payment history
- Pending payments
- Revenue

Phase 5:
- Attendance

Phase 6:
- Reports
- CSV export

Phase 7:
- Notifications architecture
- Cloud Functions
- Scheduled expiry processing

Phase 8:
- Testing
- Security review
- Performance optimization
- Production deployment

At every phase:

- Show files created/modified
- Provide complete code
- Explain important decisions
- Keep the application runnable
- Do not introduce unnecessary libraries
- Check for TypeScript errors
- Check for Firebase configuration errors

START NOW
---------
Start with Phase 1.

Before writing code, provide:

1. Final architecture
2. Firestore database structure
3. Security model
4. Complete screen/navigation map
5. Project folder structure
6. Phase-by-phase implementation plan

Then create the initial React + Firebase project.