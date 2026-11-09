import type { Metadata } from "next";
import { WorkspaceShell } from "../auth/WorkspaceShell";
import { SignInPanel } from "../auth/SignInPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", description: "Sign in to your BrizBuilder workspace." };
const ERROR_COPY: Record<string, string> = {
  invalid: "That email or password is not correct.",
  missing: "Enter your email and password.",
  rate: "Too many sign-in attempts. Wait a minute and try again.",
  config: "Sign-in is temporarily unavailable. Please try again later.",
};
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; return_to?: string | string[] }> }) {
  const { error, return_to } = await searchParams;
  return (
    <WorkspaceShell>
      <SignInPanel returnTo={safeLoginReturnTo(return_to)} error={error ? ERROR_COPY[error] ?? ERROR_COPY.invalid : undefined} />
    </WorkspaceShell>
  );
}

function safeLoginReturnTo(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length > 16_384) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";

  try {
    const url = new URL(value, "https://brizbuilder.local");
    if (url.origin !== "https://brizbuilder.local") return "/dashboard";
    if (url.pathname === "/login" || url.pathname.startsWith("/api/auth/")) {
      return "/dashboard";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
