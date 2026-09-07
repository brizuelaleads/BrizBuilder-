import { MAIN_ADMIN_EMAIL } from "../../auth-config";
import { receiveAccessRequest } from "../../../lib/access-request";
import { getSupabaseAdminClient } from "../../../lib/supabase/server";
import { accessRequestEmail, sendSystemEmail } from "../../../lib/system-email";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return receiveAccessRequest(request, {
    async save(input, networkHash) {
      const { data, error } = await getSupabaseAdminClient().rpc(
        "submit_access_request",
        {
          p_name: input.name,
          p_email: input.email,
          p_business: input.business,
          p_message: input.message,
          p_network_hash: networkHash,
        },
      );
      if (
        error ||
        !data ||
        !["accepted", "duplicate", "rate_limited"].includes(data.status)
      )
        throw new Error("Request unavailable.");
      return { status: data.status, requestId: data.request_id };
    },
    async notify(input, requestId) {
      let sent = false;
      try {
        if (MAIN_ADMIN_EMAIL.endsWith(".local"))
          throw new Error("Owner email unavailable.");
        await sendSystemEmail(accessRequestEmail(MAIN_ADMIN_EMAIL, input), {
          category: "access-request",
          idempotencyKey: `access-request/${requestId}`,
        });
        sent = true;
      } finally {
        const { error } = await getSupabaseAdminClient()
          .from("access_requests")
          .update({ notification_status: sent ? "sent" : "failed" })
          .eq("id", requestId);
        if (error) throw new Error("Notification status unavailable.");
      }
    },
  });
}
