# Draft only — do not send before rollout and live checks

Replace every bracketed item and confirm the statements against the deployed app first. Never put the test password in this file.

Hello Google Verification Team,

Regarding project brizbuilder-gbp-prod (559192025256), we have reviewed your checklist and [deployed/tested the following changes — confirm before sending]:

- Calendar consent for our isolated review workspace now requests only https://www.googleapis.com/auth/calendar.events.owned. It does not request Business Profile permission. This supports finding, creating, updating, and deleting CRM appointment events in the user's primary calendar without requesting access to calendars owned by others. Existing production connections still use calendar.events during this transition; after approval, we will enable the narrower scope for new production connections. [Confirm both active scopes are accurately declared in the console and describe the migration status.]
- We updated our privacy policy to describe Google data access, use, sharing, protection, raw and derived data restrictions, and retention/deletion: https://brizbuilder.com/privacy.
- The Calendar panel has a Disconnect Google action. Successful local disconnect removes saved credentials and connection identifiers and attempts Google revocation; failures are explained to the user. Existing Google Calendar events and CRM appointments are not automatically deleted.
- Our Google integrations do not send Google API data to third-party AI services or use it to train general-purpose models.

Updated demonstration video: [new unlisted/public video link after scope changes are deployed]. The video shows expanded permissions and creation, rescheduling, and cancellation reflected in Google Calendar.

BrizBuilder is invite-only. We have prepared a restricted demo workspace with fake data for your review:

Login: https://brizbuilder.com/login
Username: brizuelaleads+google-review@gmail.com
Password: [supply the dedicated BrizBuilder test password securely in the approved review channel; not the owner's credentials]

After signing in, open Calendar, select Google OAuth Review Demo, and choose Link Google Calendar. Connect your test Google account and create/reschedule/cancel a fake appointment. [Confirm no phone verification or payment requirement blocks this flow.]

Business Profile API access is a separate pending application. [Confirm that business.manage is excluded/deferred from this Calendar scope review, or explain its separately reviewed production-ready functionality.]

Please let us know if you need any additional information.

Thank you.
