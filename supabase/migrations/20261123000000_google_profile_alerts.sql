-- Google profile alerts: Google-applied edits, new low-star reviews, and
-- reviews left unanswered. On by default. Existing rows need no backfill:
-- normalizeNotifications() in db/branding.ts fills missing keys from
-- DEFAULT_NOTIFICATIONS on read.
alter table public.client_branding
  alter column notification_preferences set default jsonb_build_object(
    'newLead', true,
    'missedCall', true,
    'transcriptReady', true,
    'leadNotContacted', true,
    'appointmentReminder', true,
    'hotLead', true,
    'reviewRequest', false,
    'dailyDigest', false,
    'googleProfile', true
  );
