# Client App installation

BrizBuilder exposes one public installation URL per configured client brand:

`/install/{client-branding-subdomain}`

The slug is the existing validated, unique `client_branding.subdomain`. Client
and organization database IDs are never used in the public URL. A client must
have a saved Client App Address before Settings can share, copy, or encode an
install link.

## Public boundary

The installation page is intentionally public so a client can open the link
before signing in. Its server component serializes only this allowlist:

- app name
- business name
- logo URL
- app icon URL
- primary brand color
- public branding slug

Unknown, malformed, and archived client slugs return the same 404. The route is
excluded from search indexing through page metadata and `robots.txt`.

The slug-specific manifest is public at
`/install/{client-branding-subdomain}/manifest.webmanifest`. It uses the same
stored brand and existing PWA manifest builder. Its stable identity is the
public branding slug, never a private client ID.

## Authentication boundary

Installation does not grant CRM access. The installed app opens `/dashboard`,
where the existing server-side session, account-access, role, permission, and
tenant checks still apply. The install route never loads or renders leads,
calls, contacts, credentials, integrations, notification settings, or other
private CRM data.

## Device behavior

- Browsers exposing `beforeinstallprompt` receive the native installation
  prompt after a user click.
- iPhone and iPad users receive the truthful Safari Share → Add to Home Screen
  flow; no Apple-native prompt is simulated.
- Standalone mode shows App Installed and opens the authenticated dashboard.
- Unsupported desktop browsers are directed to open the link on a phone and
  may still open the dashboard normally.

QR codes are generated locally in the authenticated Settings UI from the exact
install URL. No URL or tenant data is sent to a third-party QR service.
