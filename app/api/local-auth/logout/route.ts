import { cookies } from "next/headers";
import { LOCAL_AUTH_COOKIE } from "../../../auth-config";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  cookieStore.delete(LOCAL_AUTH_COOKIE);
  return Response.redirect(new URL("/", request.url), 303);
}
