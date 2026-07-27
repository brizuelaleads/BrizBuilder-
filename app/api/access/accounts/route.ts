import { getChatGPTUser } from "../../../chatgpt-auth";
import { listAccounts } from "../../../../db/runtime-access";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const accounts = await listAccounts(user);
    return Response.json({ accounts: accounts.results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json(
      { error: message },
      { status: message === "Forbidden" ? 403 : 500 },
    );
  }
}

// The POST handler that used to live here always threw on the Supabase
// backend and is superseded by the Team tab's invite_member action, which
// carries the permission and tenant guards. It was also the one mutating
// endpoint with no same-origin check, so it is removed rather than patched.
