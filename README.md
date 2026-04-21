# CorpHQ — Employee Management Portal

Full-stack Next.js 16 app, JavaScript only. No TypeScript.

---

## Package Versions

| Package | Version | Notes |
|---------|---------|-------|
| next | ^16.2.3 | |
| react / react-dom | ^19.2.5 | |
| @prisma/client / prisma | ^6.6.0 | See note below |
| socket.io / socket.io-client | ^4.8.3 | |
| jose | ^6.0.0 | API identical to v5 — no code changes |
| bcryptjs | ^2.4.3 | |
| zod | ^3.25.0 | `.errors` shape unchanged |
| tailwindcss | ^4.2.2 | CSS-first config — see Tailwind v4 notes |
| @tailwindcss/postcss | ^4.2.2 | New — required by Tailwind v4 |

### Why Prisma 6 and not 7?

Prisma 7 is the current `latest` tag but is **not recommended for this project** because:
1. Prisma 7's new features (typed SQL, driver adapters) are TypeScript-focused; this project is pure JavaScript
2. Prisma 6 → 7 has no functional benefit for existing PostgreSQL + classic-client usage
3. Prisma 7 peer-requires `typescript >= 5.4.0` (optional but signals the direction)

Upgrade to Prisma 7 when/if you add TypeScript to the project.

### Tailwind CSS v4 Changes

Tailwind v4 is a CSS-first framework. The key differences from v3:

| v3 | v4 |
|----|----|
| `@tailwind base/components/utilities` in CSS | `@import "tailwindcss"` |
| `tailwind.config.js` with `theme.extend` | `@theme { }` block in CSS |
| `tailwindcss` PostCSS plugin | `@tailwindcss/postcss` PostCSS plugin |
| Manual `content: [...]` array | Auto-detected from project files |

**What changed in this repo:**
- `src/app/globals.css` — `@tailwind` directives replaced with `@import "tailwindcss"`; font family config moved from `tailwind.config.js` into a `@theme {}` block
- `postcss.config.js` — plugin changed from `tailwindcss` to `@tailwindcss/postcss`
- `tailwind.config.js` — now a comment-only placeholder (not read by Tailwind v4)

---

## Folder Structure

```
corp-hq/
├── server.js                              ← Start here: auto-migrate + Socket.io + cron
├── package.json
├── next.config.js
├── jsconfig.json                          ← @ path alias → src/
├── tailwind.config.js                     ← UNUSED in v4 (kept as reference comment)
├── postcss.config.js                      ← Uses @tailwindcss/postcss (v4)
├── docker-compose.yml                     ← PostgreSQL + pgAdmin
├── .env.example                           ← Copy to .env.local
│
├── prisma/
│   ├── schema.prisma                      ← DB schema (6 models)
│   └── seed.js                            ← Demo data (4 employees, 60d attendance)
│
└── src/
    ├── middleware.js                      ← Edge JWT auth + RBAC
    ├── app/
    │   ├── layout.js                      ← Root layout
    │   ├── page.js                        ← Redirects → /login
    │   ├── globals.css                    ← Design tokens + animations (Tailwind v4)
    │   ├── (auth)/login/page.js           ← Login page (public)
    │   ├── (admin)/
    │   │   ├── layout.js                  ← Admin guard + Sidebar
    │   │   └── admin/
    │   │       ├── dashboard/page.js      ← KPI cards, live feed, roster
    │   │       ├── attendance/page.js     ← Table + filters + CSV export
    │   │       ├── leaves/page.js         ← Approve/reject workflow
    │   │       ├── employees/page.js      ← Employee directory cards
    │   │       └── reports/page.js        ← Bar chart + monthly summary
    │   ├── (employee)/
    │   │   ├── layout.js                  ← Employee guard + Sidebar
    │   │   └── employee/
    │   │       ├── dashboard/page.js      ← Check-in widget + stats
    │   │       ├── attendance/page.js     ← History table
    │   │       └── leaves/page.js         ← Balance cards + apply modal
    │   └── api/
    │       ├── auth/login/route.js        ← POST login → JWT pair
    │       ├── auth/refresh/route.js      ← POST refresh token rotation
    │       ├── auth/logout/route.js       ← POST invalidate session
    │       ├── attendance/route.js        ← GET list + POST check-in
    │       ├── attendance/checkout/route.js ← PATCH check-out
    │       ├── attendance/today/route.js  ← GET today's record
    │       ├── leaves/route.js            ← GET list + POST apply
    │       ├── leaves/[id]/route.js       ← PATCH review + DELETE cancel
    │       ├── leaves/balance/route.js    ← GET balance
    │       ├── users/route.js             ← GET + POST (admin only)
    │       └── reports/monthly/route.js   ← GET monthly summary
    ├── services/
    │   ├── attendanceService.js           ← Business logic: check-in/out, auto-checkout
    │   └── leaveService.js               ← Apply, review, cancel + DB transactions
    ├── lib/
    │   ├── db.js                          ← Prisma singleton
    │   ├── auth.js                        ← JWT sign/verify + ApiError (jose v6)
    │   ├── socket.js                      ← Socket.io server + emit helpers
    │   ├── validations.js                 ← Zod schemas for all inputs
    │   └── utils.js                       ← Pure helpers (format, CSV, etc.)
    ├── hooks/
    │   ├── useAuth.js                     ← Auth state, auto-refresh, authFetch
    │   └── useSocket.js                   ← Typed Socket.io client hook
    └── components/
        ├── providers/AuthProvider.js      ← Global auth + socket context
        ├── layout/Sidebar.js             ← Collapsible, role-aware nav
        └── ui/index.js                   ← 20+ components: Avatar, Badge, Card, etc.
```

---

## Quick Start

### Option A — Docker (zero setup)

```bash
# 1. Start PostgreSQL
docker compose up -d db

# 2. Install
npm install

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local — generate JWT secrets:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 4. One-shot setup (migrate + seed)
npm run setup

# 5. Start
npm run dev        # → http://localhost:3000
```

### Option B — Existing PostgreSQL

```bash
createdb corp_hq
npm install
cp .env.example .env.local
# Set DATABASE_URL + JWT secrets in .env.local
npm run setup
npm run dev
```

---

## How Auto-Migration Works

`server.js` runs before the Next.js app starts:

```
node server.js
  1. npx prisma migrate deploy   ← applies pending migrations, skips already-applied
  2. next.prepare()              ← compiles Next.js
  3. initSocket(httpServer)      ← attaches Socket.io
  4. setInterval(autoCheckout)   ← every 15 min
  5. httpServer.listen(3000)
```

`migrate deploy` is **safe and idempotent** — it never resets data.

### Schema change workflow

```bash
# 1. Edit prisma/schema.prisma
# 2. Create migration file
npm run db:migrate
#    Prompt: "Name for migration?" → e.g. add_phone_field
#    Creates: prisma/migrations/20260420_add_phone_field/migration.sql

# 3. Commit the migration alongside your code
git add prisma/migrations/
git commit -m "feat: add phone field to users"

# 4. On next deploy, server.js auto-applies it
```

### Migration commands

| Command | What it does |
|---------|-------------|
| `npm run db:migrate`      | Create + apply new migration (dev) |
| `npm run db:migrate:prod` | Apply pending migrations (prod-safe) |
| `npm run db:push`         | Sync schema without migration files (prototyping) |
| `npm run db:reset`        | Drop + recreate + reseed (destroys data!) |
| `npm run db:status`       | Show applied/pending migrations |
| `npm run db:seed`         | Re-run seed data |
| `npm run db:studio`       | Open Prisma Studio GUI |

---

## Demo Accounts

| Role     | Email            | Password     |
|----------|------------------|--------------|
| **Admin** | sarah@corp.io   | password123  |
| Employee | marcus@corp.io   | password123  |
| Employee | priya@corp.io    | password123  |
| Employee | jordan@corp.io   | password123  |
| Employee | aiden@corp.io    | password123  |

---

## API Endpoints

```
POST   /api/auth/login              { email, password }
POST   /api/auth/refresh            { refreshToken }
POST   /api/auth/logout             { refreshToken }

GET    /api/attendance              ?date=&month=&userId=&status=&page=&limit=
POST   /api/attendance              { timezone }            → check in
PATCH  /api/attendance/checkout     { timezone }            → check out
GET    /api/attendance/today                                → today's record

GET    /api/leaves                  ?status=&userId=&page=&limit=
POST   /api/leaves                  { type, startDate, endDate, reason }
PATCH  /api/leaves/:id              { action, reviewNote }  → admin review
DELETE /api/leaves/:id                                      → employee cancel
GET    /api/leaves/balance                                  → leave balance

GET    /api/users                                           → admin only
POST   /api/users                   { email, name, password, role, department }

GET    /api/reports/monthly         ?year=&month=
```

---

## Socket.io Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `attendance:checkin` | Server → admin-room | `{ userId, userName, checkIn, isLate }` |
| `attendance:checkout` | Server → admin-room | `{ userId, checkOut, hoursWorked }` |
| `leave:applied` | Server → admin-room | `{ leaveId, userId, userName, type, days }` |
| `leave:reviewed` | Server → user-{id} | `{ leaveId, status, reviewNote }` |

---

## Environment Variables (.env.local)

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/corp_hq"
JWT_ACCESS_SECRET="..."     # 64-char hex
JWT_REFRESH_SECRET="..."    # 64-char hex
JWT_ACCESS_EXPIRY="15m"
JWT_REFRESH_EXPIRY="7d"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```
