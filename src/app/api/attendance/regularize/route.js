import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { regularizationService } from "@/services/regularizationService";
import { RegularizationRequestSchema, RegularizationFilterSchema } from "@/lib/validations";

export async function GET(request) {
    try {
        const user = getCurrentUser(request);
        const sp = new URL(request.url).searchParams;

        // FIX (CodeRabbit #9): page/limit/status/userId were previously
        // accepted unvalidated — parseInt(sp.get("page")) on a garbage value
        // returns NaN, which Prisma's skip/take then chokes on with a raw
        // 500. Reuses the same AttendanceFilterSchema-style zod validation
        // already used elsewhere in the codebase (page/limit bounds, status
        // enum) instead of ad-hoc parseInt.
        const params = Object.fromEntries(sp);
        const filters = RegularizationFilterSchema.parse(params);

        if (user.role === "EMPLOYEE") filters.userId = user.id;

        const result = await regularizationService.list(filters);
        return Response.json(result);
    } catch (err) {
        if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
        return handleApiError(err);
    }
}

export async function POST(request) {
    try {
        const user = getCurrentUser(request);
        if (user.role !== "EMPLOYEE") throw new ApiError("Only employees can request regularization", 403);
        const body = RegularizationRequestSchema.parse(await request.json());
        const req = await regularizationService.request(user.id, body);
        return Response.json(req, { status: 201 });
    } catch (err) {
        if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
        return handleApiError(err);
    }
}