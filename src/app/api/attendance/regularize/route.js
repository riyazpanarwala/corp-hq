import { getCurrentUser, handleApiError, ApiError } from "@/lib/auth";
import { regularizationService } from "@/services/regularizationService";
import { RegularizationRequestSchema } from "@/lib/validations";

export async function GET(request) {
    try {
        const user = getCurrentUser(request);
        const sp = new URL(request.url).searchParams;
        const status = sp.get("status") || "all";
        const page = parseInt(sp.get("page") || "1");
        const limit = parseInt(sp.get("limit") || "20");

        const filters = { status, page, limit };
        if (user.role === "EMPLOYEE") filters.userId = user.id;
        else if (sp.get("userId")) filters.userId = parseInt(sp.get("userId"));

        const result = await regularizationService.list(filters);
        return Response.json(result);
    } catch (err) {
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