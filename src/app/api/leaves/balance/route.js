// src/app/api/leaves/balance/route.js
import { getCurrentUser, handleApiError } from "@/lib/auth";
import { leaveService }                   from "@/services/leaveService";

export async function GET(request) {
  try {
    const user    = getCurrentUser(request);
    const balance = await leaveService.getBalance(user.id);
    return Response.json({ balance });
  } catch (err) {
    return handleApiError(err);
  }
}
