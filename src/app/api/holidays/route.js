import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { holidayService } from "@/services/holidayService";
import { CreateHolidaySchema } from "@/lib/validations";

// Any authenticated user can view the calendar — no proxy admin gate needed.
export async function GET(request) {
    try {
        getCurrentUser(request);
        const sp = new URL(request.url).searchParams;
        const rawYear = sp.get("year");

        // FIX (CodeRabbit #9): previously parseInt(rawYear) silently accepted
        // malformed values like "2026x" (parses to 2026) or "abc" (parses to
        // NaN, which Prisma would then choke on downstream). Now the full
        // string must be a 4-digit year, and 0/negative years are rejected.
        let year;
        if (rawYear !== null) {
            if (!/^\d{1,4}$/.test(rawYear) || Number(rawYear) < 1) {
                throw new ApiError("Invalid year", 422);
            }
            year = Number(rawYear);
        }

        const holidays = await holidayService.list({ year });
        return Response.json({ holidays });
    } catch (err) {
        return handleApiError(err);
    }
}

export async function POST(request) {
    try {
        const user = getCurrentUser(request);
        if (user.role !== "ADMIN") throw new ApiError("Admin access required", 403);
        const body = CreateHolidaySchema.parse(await request.json());
        const holiday = await holidayService.create(body);
        return Response.json(holiday, { status: 201 });
    } catch (err) {
        if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
        return handleApiError(err);
    }
}