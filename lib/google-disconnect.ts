export type GoogleDisconnectOperations = {
  stopSync: () => Promise<void>;
  removeCalendarAppointments?: () => Promise<number>;
  loadRefreshTokens: () => Promise<string[]>;
  revoke: (token: string) => Promise<void>;
  deleteLocalData: () => Promise<void>;
};

/** Revocation is best effort; failed provider requests never retain local tokens. */
export async function disconnectGoogleAccess(operations: GoogleDisconnectOperations) {
  await operations.stopSync();
  let calendarAppointmentsRemoved: number | null = null;
  let calendarCleanupWarning: string | null = null;
  if (operations.removeCalendarAppointments) {
    try {
      calendarAppointmentsRemoved = await operations.removeCalendarAppointments();
    } catch {
      calendarCleanupWarning = "Google Calendar could not confirm removal of all synced appointments. Check Google Calendar for any remaining BrizBuilder events.";
    }
  }
  let googleRevocationConfirmed = false;
  try {
    const tokens = [...new Set(await operations.loadRefreshTokens())];
    const results = await Promise.allSettled(tokens.map(operations.revoke));
    googleRevocationConfirmed = results.every((result) => result.status === "fulfilled");
  } catch {
    // Still delete local data when a saved token cannot be read/decrypted.
  }
  // Do not report a successful local disconnect if deletion fails.
  await operations.deleteLocalData();
  return {
    disconnected: true,
    calendarAppointmentsRemoved,
    calendarCleanupWarning,
    googleRevocationConfirmed,
    revocationRetryAvailable: false,
    revocationWarning: googleRevocationConfirmed ? null :
      "Disconnected locally and removed saved Google credentials. Google revocation could not be confirmed. Remove BrizBuilder from your Google Account permissions to finish removing access.",
  };
}
