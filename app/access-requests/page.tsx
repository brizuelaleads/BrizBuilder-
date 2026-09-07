import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MAIN_ADMIN_EMAIL } from "../auth-config";
import { getChatGPTUser } from "../chatgpt-auth";
import { getSupabaseAdminClient } from "../../lib/supabase/server";
import styles from "../request-access/access.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Access requests",
  robots: { index: false, follow: false },
};

export default async function AccessRequestsPage() {
  const user = await getChatGPTUser();
  if (!user) redirect("/login?return_to=%2Faccess-requests");
  // Applicants are platform-level records. Never expose them to client accounts.
  if (
    user.email.toLowerCase() !== MAIN_ADMIN_EMAIL ||
    MAIN_ADMIN_EMAIL.endsWith(".local")
  )
    notFound();
  const { data, error } = await getSupabaseAdminClient()
    .from("access_requests")
    .select(
      "id,name,email,business,message,created_at,contact_consent_at,notification_status",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <main className={styles.inbox}>
      <div className={styles.inboxInner}>
        <Link href="/dashboard">← Back to dashboard</Link>
        <header>
          <h1>Access requests</h1>
          <p>
            The 100 most recent business requests. Submitting this form never
            grants access.
          </p>
          <Link href="/dashboard?view=team">
            Invite an approved team member
          </Link>
        </header>
        {error ? (
          <p role="alert">
            Requests couldn’t be loaded. Check the access-request migration and
            try again.
          </p>
        ) : !data?.length ? (
          <p>No requests yet.</p>
        ) : (
          <ol className={styles.requests}>
            {data.map((request) => (
              <li key={request.id}>
                <h2>{request.business}</h2>
                <p>
                  {request.name} ·{" "}
                  <a href={`mailto:${encodeURIComponent(request.email)}`}>
                    {request.email}
                  </a>
                </p>
                <p className={styles.message}>
                  {request.message || "No message provided."}
                </p>
                <p className={styles.meta}>
                  Received{" "}
                  {new Date(request.created_at).toLocaleString("en-US", {
                    timeZone: "UTC",
                  })}{" "}
                  UTC · Contact consent recorded
                </p>
                <p className={styles.meta}>
                  Administrator notification:{" "}
                  {request.notification_status === "sent"
                    ? "sent"
                    : request.notification_status === "failed"
                      ? "not sent — request saved here"
                      : "pending"}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
