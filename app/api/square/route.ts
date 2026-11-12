import { getChatGPTUser } from "../../chatgpt-auth";
import {
  cancelSquareInvoiceForScope,
  createSquareInvoiceForScope,
  deleteSquareInvoiceForScope,
  disconnectSquare,
  getSquareWorkspace,
  parseSquareScope,
  sendSquareInvoice,
  syncSquareInvoices,
  type InvoiceFile,
} from "../../../db/supabase-square";
import { MAX_ATTACHMENT_BYTES } from "../../../lib/square-core";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };
// The PDF plus a small JSON envelope.
const MAX_REQUEST_BYTES = MAX_ATTACHMENT_BYTES + 256_000;

// Same rule as /api/crm: a state-changing request must prove it came from this
// site. A missing Origin is not treated as same-origin.
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === new URL(request.url).host;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "none";
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
  return Response.json({ error: message }, { status, headers: PRIVATE_NO_STORE });
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_NO_STORE });
  try {
    const params = new URL(request.url).searchParams;
    const scope = parseSquareScope(params.get("scope"), params.get("clientId"));
    return Response.json(
      { data: await getSquareWorkspace(user, scope) },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_NO_STORE });
  if (!sameOrigin(request))
    return Response.json(
      { error: "Invalid request origin." },
      { status: 403, headers: PRIVATE_NO_STORE },
    );
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES)
    return Response.json(
      { error: "That file is too large. Attach a PDF under 10 MB." },
      { status: 413, headers: PRIVATE_NO_STORE },
    );

  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    let input: Record<string, unknown>;
    let file: InvoiceFile | null = null;

    if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const payload = form.get("payload");
      if (typeof payload !== "string" || payload.length > 200_000)
        throw new Error("Request is not valid.");
      input = JSON.parse(payload) as Record<string, unknown>;
      const upload = form.get("contract");
      if (upload && typeof upload !== "string") {
        if (upload.size > MAX_ATTACHMENT_BYTES)
          throw new Error("That file is too large. Attach a PDF under 10 MB.");
        if (upload.size > 0)
          file = {
            name: upload.name || "contract.pdf",
            bytes: new Uint8Array(await upload.arrayBuffer()),
          };
      }
    } else if (contentType.startsWith("application/json")) {
      input = (await request.json()) as Record<string, unknown>;
    } else {
      return Response.json(
        { error: "Unsupported content type." },
        { status: 415, headers: PRIVATE_NO_STORE },
      );
    }
    if (!input || typeof input !== "object") throw new Error("Request is not valid.");

    const scope = parseSquareScope(input.scope, input.clientId);
    let result: unknown;
    switch (input.action) {
      case "create_invoice":
        result = await createSquareInvoiceForScope(user, scope, input.invoice, file);
        break;
      case "send_invoice":
        result = await sendSquareInvoice(user, scope, input.invoiceId);
        break;
      case "cancel_invoice":
        result = await cancelSquareInvoiceForScope(user, scope, input.invoiceId);
        break;
      case "delete_invoice":
        result = await deleteSquareInvoiceForScope(user, scope, input.invoiceId);
        break;
      case "sync":
        result = await syncSquareInvoices(user, scope);
        break;
      case "disconnect":
        result = await disconnectSquare(user, scope);
        break;
      default:
        throw new Error("Unknown Square action.");
    }
    return Response.json(
      { result, data: await getSquareWorkspace(user, scope) },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
