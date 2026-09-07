import type { Metadata } from "next";
import { AuthShell } from "../auth/AuthShell";
import { AccessRequestForm } from "./AccessRequestForm";

export const metadata: Metadata = {
  title: "Request access",
  description: "Request a private BrizBuilder workspace for your business.",
};

export default function RequestAccessPage() {
  return (
    <AuthShell
      eyebrow="Private business platform"
      title="Let’s get your team connected."
      description="BrizBuilder is for LB Marketing and invited client businesses. Tell us about your business and we’ll help with the next step."
      trustItems={[
        "Reviewed by our team",
        "No account created automatically",
        "Your business, one workspace",
      ]}
    >
      <p>GET STARTED</p>
      <h2>Request access</h2>
      <span className="auth-card-copy">
        We’ll review your request and contact you by email.
      </span>
      <AccessRequestForm />
    </AuthShell>
  );
}
