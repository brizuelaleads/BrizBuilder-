/** Whole UTC calendar days, including today. Meta's daily dates are account-local. */
export function reportingWindow(range: string, generatedAt: string) {
  const end = Date.parse(generatedAt);
  if (!Number.isFinite(end)) throw new Error("Invalid report timestamp.");
  const days = Number(range);
  const today = new Date(end);
  today.setUTCHours(0, 0, 0, 0);
  const start =
    range === "all" || !Number.isFinite(days) || days <= 0
      ? null
      : today.getTime() - (Math.floor(days) - 1) * 86_400_000;
  return {
    start,
    end,
    startDate:
      start == null ? null : new Date(start).toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
  };
}
