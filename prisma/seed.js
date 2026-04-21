// prisma/seed.js
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const db = new PrismaClient();

function addHours(date, h) { return new Date(date.getTime() + h * 3_600_000); }
function isWeekend(d)       { return d.getDay() === 0 || d.getDay() === 6; }
function workDayAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  console.log("🌱  Seeding database…");

  const PASS = await bcrypt.hash("password123", 12);

  await db.attendanceConfig.upsert({
    where: { id: 1 }, update: {},
    create: { id: 1, workStartHour: 9, workStartMinute: 0, lateThresholdMin: 30, halfDayHours: 4.0, fullDayHours: 8.0, autoCheckoutHours: 10 },
  });

  const admin = await db.user.upsert({
    where: { email: "sarah@corp.io" }, update: {},
    create: { email: "sarah@corp.io", name: "Sarah Chen", passwordHash: PASS, role: "ADMIN", department: "HR", designation: "HR Manager", timezone: "America/New_York" },
  });

  const employeeRows = [
    { email: "marcus@corp.io",  name: "Marcus Webb",  department: "Engineering", designation: "Senior Developer",  timezone: "America/Los_Angeles" },
    { email: "priya@corp.io",   name: "Priya Sharma", department: "Design",      designation: "UI/UX Designer",    timezone: "Asia/Kolkata"        },
    { email: "jordan@corp.io",  name: "Jordan Lee",   department: "Marketing",   designation: "Marketing Lead",    timezone: "America/Chicago"     },
    { email: "aiden@corp.io",   name: "Aiden Park",   department: "Engineering", designation: "Backend Engineer",  timezone: "America/New_York"    },
  ];

  const employees = await Promise.all(
    employeeRows.map(e => db.user.upsert({ where: { email: e.email }, update: {}, create: { ...e, passwordHash: PASS, role: "EMPLOYEE" } }))
  );

  const year = new Date().getFullYear();
  await Promise.all(
    employees.map(emp => db.leaveBalance.upsert({ where: { userId: emp.id }, update: {}, create: { userId: emp.id, year } }))
  );

  let attCount = 0;
  for (const emp of employees) {
    for (let d = 60; d >= 1; d--) {
      const date = workDayAgo(d);
      if (isWeekend(date)) continue;
      if (Math.random() < 0.06) continue;

      const rand    = Math.random();
      const lateMin = rand > 0.75 ? 31 + Math.floor(Math.random() * 45) : Math.floor(Math.random() * 22);
      const isLate  = lateMin >= 30;
      const checkIn = new Date(date);
      checkIn.setHours(9, lateMin, Math.floor(Math.random() * 60), 0);
      const hours     = rand < 0.08 ? 3.5 + Math.random() : 7.5 + Math.random() * 2;
      const isHalfDay = hours < 4.5;
      const checkOut  = addHours(checkIn, hours);

      try {
        await db.attendance.upsert({
          where:  { userId_date: { userId: emp.id, date } },
          update: {},
          create: {
            userId: emp.id, date, checkIn, checkOut,
            checkInTz: emp.timezone, checkOutTz: emp.timezone,
            hoursWorked: Math.round(hours * 100) / 100,
            isLate, lateMinutes: isLate ? lateMin - 30 : 0, isHalfDay,
            status: isHalfDay ? "HALF_DAY" : "PRESENT",
          },
        });
        attCount++;
      } catch (_) { /* skip duplicate */ }
    }
  }

  const seeds = [
    { userId: employees[0].id, type: "CL", startDate: new Date("2026-04-21"), endDate: new Date("2026-04-22"), days: 2, reason: "Personal errands.",  status: "PENDING"  },
    { userId: employees[1].id, type: "SL", startDate: new Date("2026-04-10"), endDate: new Date("2026-04-10"), days: 1, reason: "Fever and body ache.", status: "APPROVED", reviewedById: admin.id, reviewedAt: new Date("2026-04-09"), reviewNote: "Approved. Get well soon!" },
    { userId: employees[2].id, type: "PL", startDate: new Date("2026-04-28"), endDate: new Date("2026-05-02"), days: 5, reason: "Family vacation.",    status: "PENDING"  },
    { userId: employees[3].id, type: "CL", startDate: new Date("2026-04-05"), endDate: new Date("2026-04-05"), days: 1, reason: "Doctor appointment.", status: "REJECTED", reviewedById: admin.id, reviewedAt: new Date("2026-04-04"), reviewNote: "Critical sprint week." },
  ];
  for (const s of seeds) {
    await db.leaveRequest.create({ data: s }).catch(() => {});
  }
  await db.leaveBalance.update({ where: { userId: employees[1].id }, data: { slUsed: { increment: 1 } } });

  console.log(`✅  Done — ${employees.length} employees, ${attCount} attendance records, ${seeds.length} leaves`);
  console.log("   Admin   → sarah@corp.io  / password123");
  console.log("   Employee→ marcus@corp.io / password123");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
