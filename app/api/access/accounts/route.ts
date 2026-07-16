import { getChatGPTUser } from "../../../chatgpt-auth";
import { listAccounts, upsertClientAccount } from "../../../../db/access";

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

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = (await request.json()) as {
      email?: string;
      displayName?: string;
      clientId?: string;
    };
    const account = await upsertClientAccount(user, {
      email: payload.email ?? "",
      displayName: payload.displayName ?? "",
      clientId: payload.clientId ?? "",
    });
    return Response.json({ account }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json(
      { error: message },
      { status: message === "Forbidden" ? 403 : 400 },
    );
  }
}
