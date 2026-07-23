import {
  handleMcpOptions,
  handleMcpPost,
  handleMcpUnsupportedMethod,
} from "../../lib/ai-connector/mcp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMcpPost(request);
}

export function OPTIONS() {
  return handleMcpOptions();
}

export function GET(request: Request) {
  return handleMcpUnsupportedMethod(request);
}

export function DELETE(request: Request) {
  return handleMcpUnsupportedMethod(request);
}
