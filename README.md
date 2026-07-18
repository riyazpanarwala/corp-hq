# CorpHQ

CorpHQ is a responsive employee attendance and leave-management portal built with Next.js. It gives employees a simple place to check in, request leave, and correct attendance, while managers and HR get team-level workflows, reports, and real-time updates.

The project is written in JavaScript and uses PostgreSQL, Prisma, Tailwind CSS, JWT authentication, and Socket.IO.

## What you can do

### Employees

- Check in and check out in their saved timezone.
- See today's status, hours worked, late time, and monthly attendance history.
- Request a correction for a missing or incorrect attendance record and cancel a pending request.
- View Casual Leave (CL), Sick Leave (SL), and Privilege Leave (PL) balances.
- Apply for future leave and cancel a pending request before it starts.
- See company-wide and department-specific upcoming holidays.
- Reset a forgotten password using a single-use, 30-minute email link.

### Managers

A user becomes a manager when an admin assigns at least one direct report. Managers keep all employee features and can also:

- View attendance for their direct reports.
- View, approve, or reject leave requests from their direct reports.

Manager access is restricted to direct reports; managers cannot browse or review other teams.

### Admins / HR

- Monitor today's workforce status and live check-in/check-out activity.
- Add attendance entries, correct existing entries, filter records, and export CSV files.
- Review attendance regularization requests; approval creates or updates the attendance record.
- Review leave requests and record approved leave for past working days.
- Add employees, assign or change managers, and deactivate employee accounts.
- Maintain company-wide or department-specific holidays. Applicable holidays are excluded from leave-day calculations.
- View monthly attendance analytics and export reports to CSV.

The navigation is role-aware, collapsible on desktop, and an off-canvas drawer on mobile.

## Roles at a glance

| Area | Employee | Manager | Admin |
| --- | :---: | :---: | :---: |
| Own attendance and leave | Yes | Yes | Not exposed in admin UI |
| Direct-report attendance | No | Yes | Yes, all employees |
| Review leave | No | Direct reports | All employees |
| Review attendance corrections | No | No | Yes |
| Employees and reporting hierarchy | No | View direct reports | Manage |
| Holidays and reports | View holidays | View holidays | Manage / export |

## Quick start

### Prerequisites

- Node.js 20.9 or newer
- npm
- PostgreSQL 16, either installed locally or run with Docker
- A Resend account only if you want password-reset emails to be delivered

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env`.

Generate two different JWT secrets by running this command twice and put the results in `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

At minimum, verify these values in `.env`:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/corp_hq"
JWT_ACCESS_SECRET="first_generated_secret"
JWT_REFRESH_SECRET="second_generated_secret"
JWT_ACCESS_EXPIRY="15m"
JWT_REFRESH_EXPIRY="7d"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NODE_ENV="development"
```

`NEXT_PUBLIC_APP_URL` must be the application's exact origin. Use HTTPS in production.

For password recovery, also configure:

```dotenv
RESEND_API_KEY="re_your_api_key"
RESEND_FROM="CorpHQ <no-reply@your-verified-domain.com>"
```

The application can otherwise run without Resend, but forgot-password emails will not be sent. Do not commit real secrets.

### 3. Start PostgreSQL

With Docker:

```bash
docker compose up -d db
```

Or create a `corp_hq` database in an existing PostgreSQL instance and update `DATABASE_URL`.

Optional pgAdmin is available at [http://localhost:5050](http://localhost:5050):

```bash
docker compose up -d pgadmin
```

The development credentials in `docker-compose.yml` are `admin@corp.io` / `admin`.

### 4. Apply migrations and add demo data

```bash
npm run db:migrate:prod
npm run db:seed
```

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Demo accounts

All seeded accounts use the password `password123`.

| Role | Email | Example use |
| --- | --- | --- |
| Admin | `sarah@corp.io` | HR and admin workflows |
| Employee | `marcus@corp.io` | Attendance and leave |
| Employee | `priya@corp.io` | Attendance and leave |
| Employee | `jordan@corp.io` | Attendance and leave |
| Employee | `aiden@corp.io` | Attendance and leave |

The seed adds four employees, current-year leave balances, about 60 days of sample attendance, and sample leave requests. Manager relationships and holidays can be added from the admin UI.

## How the main workflows behave

### Attendance

- Check-in uses the employee's timezone and the configured work-start rules.
- The default grace period ends at 09:30; a 09:31 check-in is one minute late.
- Check-out calculates hours worked and half-day status.
- The custom server checks every 15 minutes for sessions that exceed the configured auto-checkout duration.
- Admins can create a missing record or edit an existing record directly.
- Employees can instead submit a regularization request. Only an admin can approve or reject it.

### Leave and holidays

- Leave requests support CL, SL, and PL balances.
- Weekends and applicable company or department holidays are not charged as leave days.
- Pending leave reserves the requested balance. Approval moves it to used balance; rejection or cancellation releases it.
- Employees cannot apply for past dates or cancel leave that has already started.
- Admins can record past leave for valid working days.
- Managers can review only their direct reports' requests.

### Authentication

- Login creates a short-lived access token and a rotating refresh-token session.
- Auth cookies are HTTP-only, and protected routes enforce role and manager scope on the server.
- Password-reset responses do not reveal whether an email is registered.
- Reset links expire after 30 minutes, work once, and invalidate the user's existing sessions after a successful reset.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the custom Next.js + Socket.IO server in development |
| `npm run build` | Create a production build |
| `npm run start` | Run the custom server with `NODE_ENV=production` on POSIX shells |
| `npm run setup` | Install, generate Prisma Client, create a dev migration, and seed |
| `npm run db:generate` | Regenerate Prisma Client |
| `npm run db:migrate` | Create and apply a migration during development |
| `npm run db:migrate:prod` | Apply committed migrations without resetting data |
| `npm run db:status` | Show migration status |
| `npm run db:seed` | Add or refresh demo seed data |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:push` | Push schema changes without creating a migration |
| `npm run db:reset` | **Delete all database data**, reapply migrations, and reseed |

`server.js` runs `prisma migrate deploy` before every app start, then prepares Next.js, attaches Socket.IO, starts the auto-checkout timer, and listens on `PORT` (default `3000`). If migration deployment fails, startup stops. Development fallback to the potentially destructive `prisma db push --accept-data-loss` is possible only when `ALLOW_DB_PUSH=true`; avoid it for any database containing valuable data.

## API overview

All endpoints except login, token refresh, forgot password, and reset password require authentication.

### Authentication

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Sign in with email and password |
| `POST` | `/api/auth/refresh` | Rotate the session and issue a new access token |
| `POST` | `/api/auth/logout` | End the current session |
| `POST` | `/api/auth/forgot-password` | Request a password-reset email |
| `POST` | `/api/auth/reset-password` | Set a new password with a reset token |

### Attendance and corrections

| Method | Endpoint | Access / purpose |
| --- | --- | --- |
| `GET` | `/api/attendance` | Own, direct-report, or all attendance according to role |
| `POST` | `/api/attendance` | Employee check-in or admin manual entry |
| `PATCH` | `/api/attendance/checkout` | Check out the signed-in user |
| `GET` | `/api/attendance/today` | Get the signed-in user's record for today |
| `GET` | `/api/attendance/regularize` | List correction requests according to role |
| `POST` | `/api/attendance/regularize` | Employee creates a correction request |
| `PATCH` | `/api/attendance/regularize/:id` | Admin approves or rejects a request |
| `DELETE` | `/api/attendance/regularize/:id` | Employee cancels their pending request |

Attendance list filters include `date`, `month`, `userId`, `status`, `page`, and `limit`. Managers use `scope=team` for direct-report data.

### Leave

| Method | Endpoint | Access / purpose |
| --- | --- | --- |
| `GET` | `/api/leaves` | List requests according to role and scope |
| `POST` | `/api/leaves` | Apply for leave |
| `PATCH` | `/api/leaves/:id` | Admin or direct manager approves/rejects |
| `DELETE` | `/api/leaves/:id` | Employee cancels their pending request |
| `GET` | `/api/leaves/balance` | Get the signed-in user's balance |
| `POST` | `/api/leaves/record-past` | Admin records approved past leave |

Leave list filters include `status`, `userId`, `page`, and `limit`. Managers use `scope=team`.

### People, holidays, and reports

| Method | Endpoint | Access / purpose |
| --- | --- | --- |
| `GET` | `/api/users` | Admin lists active users; manager lists direct reports |
| `POST` | `/api/users` | Admin creates an employee or admin |
| `PATCH` | `/api/users/:id` | Admin assigns or removes a manager |
| `DELETE` | `/api/users/:id` | Admin deactivates an employee |
| `GET` | `/api/departments` | List active departments |
| `GET` | `/api/holidays` | List holidays, optionally filtered by `year` |
| `POST` | `/api/holidays` | Admin creates a holiday |
| `DELETE` | `/api/holidays/:id` | Admin removes a holiday |
| `GET` | `/api/reports/monthly` | Admin monthly attendance summary |

## Real-time updates

Socket.IO keeps relevant screens current without a manual refresh:

- `attendance:checkin` and `attendance:checkout` update admin attendance views.
- `leave:applied` updates the admin leave view.
- `leave:reviewed` updates the affected employee.
- `regularization:requested` updates the admin review queue.
- `regularization:reviewed` refreshes the affected employee's request and attendance data.

## Project structure

```text
corp-hq/
|-- prisma/
|   |-- migrations/          # Committed PostgreSQL migrations
|   |-- schema.prisma        # Data model and relationships
|   `-- seed.js              # Demo accounts and sample records
|-- src/
|   |-- app/                 # Pages, layouts, and API route handlers
|   |-- components/          # Shared UI, provider, and navigation
|   |-- hooks/               # Authentication and Socket.IO hooks
|   |-- lib/                 # Auth, DB, email, validation, and utilities
|   |-- services/            # Attendance, leave, holiday, and correction rules
|   `-- proxy.js             # Next.js 16 route authentication and access control
|-- docker-compose.yml       # PostgreSQL and optional pgAdmin
|-- server.js                # Migrations, Next.js, Socket.IO, and auto-checkout
`-- .env.example             # Environment variable template
```

## Tech stack

- Next.js 16 and React 19
- PostgreSQL 16 and Prisma 6
- Tailwind CSS 4
- JWT signing with `jose` and password hashing with `bcryptjs`
- Socket.IO for real-time updates
- Zod for request validation
- Resend for password-reset email

Tailwind 4 is configured through `@import "tailwindcss"` and the `@theme` block in `src/app/globals.css`; `tailwind.config.js` is retained only as a reference placeholder.

## Changing the database schema

1. Edit `prisma/schema.prisma`.
2. Run `npm run db:migrate` and give the migration a descriptive name.
3. Commit the generated directory under `prisma/migrations/` with the code that uses it.
4. Deployment or the next custom-server startup applies it with `prisma migrate deploy`.

Committed migrations are the source of truth. Use `db:push` only for disposable prototyping databases.
