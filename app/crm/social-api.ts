export async function socialData<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as { data?: T; error?: string } | null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error ?? "Social is temporarily unavailable.");
  return payload.data;
}

export async function socialRead<T>(params: Record<string, string>, signal?: AbortSignal) {
  return socialData<T>(await fetch(`/api/social?${new URLSearchParams(params)}`, { cache: "no-store", signal }));
}

export async function socialWrite<T>(params: Record<string, unknown>) {
  return socialData<T>(await fetch("/api/social", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
  }));
}
