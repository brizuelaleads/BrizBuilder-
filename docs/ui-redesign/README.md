# BrizBuilder visual redesign

## Push integration update

Before pushing, remote `main` had advanced to `ba00d42`. The redesign was rebased onto those commits, retaining their single-light-mode behavior and updated interactive Dashboard rendering. The earlier dark-mode screenshots and original-baseline counts below describe the pre-rebase review, not the merged application.

The merged version passes typecheck, lint, the full test/build suite, and a fresh 52-screen desktop/mobile sweep across all 26 tabs with no runtime errors or document overflow. `push-audit.json` records that sweep. Modal/client-account checks were repeated. `upstream-baseline.json` records the upstream source, and the preservation checker now compares against it: 483 handlers, 96 requests, 558 field attributes and 6 chart markup sites preserved; Dashboard source unchanged from upstream (line endings normalized). The original `baseline.json` remains as historical evidence.

Legacy visual rules added upstream are excluded from `.crm-design-system` so they cannot override the new charcoal sidebar and shared components. The logo uses the light asset for that charcoal background. All upstream application behavior is retained.

## Brief and preservation contract

Reading this as an operational CRM for agency and client users, using the supplied shadcn Figma component library with BrizBuilder charcoal, white, and purple. Layout variance 2, motion 1, density 7. The taste skill explicitly excludes dashboards; its landing-page composition rules do not override this product's existing content or the supplied component library.

The source inventory in `baseline.json` was generated before application changes. It records each TSX file, its hash, controls, field attributes, event handlers, API calls, chart markup, and component names. This is the preservation reference, not the older feature roadmap (which understates several current integrations).

## Screens and workflows inspected

| Surface | Content and behavior retained |
| --- | --- |
| Shell | Agency/client navigation, history/query routes, workspace picker, date ranges, search/Ctrl-K, appearance persistence, password change, POST sign-out, notifications, mobile menu and dock |
| Dashboard | KPI values and trend sparklines, marketing spend/progress, appointments sparkline, source donut/legend, attention actions, today's appointments, pipeline counts/progress, recent leads and detail links |
| Leads and Pipeline | Search, filters, CSV export, add/delete, list/pipeline switch, stage movement/drag and drop, lead detail drawer, estimated value, revenue/status, follow-up, notes, call recordings/transcripts and attribution |
| Calls | All/missed/answered/inbound/outbound filters, follow-up queue, detail, callback, mark handled, linked leads, recording and transcript states |
| Contacts and Companies | Search, CSV import/export, contact detail/calls, company creation, relationships and linking |
| Calendar and Tasks | Calendar/list/day/week/month navigation, appointment create/status/delete, Google Calendar connection, task filters/create/complete |
| Ads and Reports | Campaign metrics and drill-down, attribution, reporting ranges, source/revenue graphics, snippets and lead links |
| Conversations and Phone | Thread selection, messages/composer, new message, phone setup, owned-number/search/purchase flows, A2P, provider states |
| Connections | Existing provider cards, credentials/configuration, connect/disconnect/sync/backfill, billing permissions, AI connector handoff |
| Automations | Workflow list/editor, node/edge operations, drag coordinates, configuration, save/test/publish and run history |
| Websites | Website creation/edit, capture snippets, handoff, disconnect/delete, CallRail DNI setup |
| Google Profiles | Client picker, OAuth connection, location chooser, refresh/disconnect, review link |
| Reviews | Overview/inbox/requests/settings tabs, filters, review detail, reply/delete, request consent/send, QR/download, Google refresh/pagination |
| Payments | Client selector, account setup, status/refresh, all Stripe embedded tabs/capabilities and error/retry flows |
| Sub-accounts | Client creation, management and protected deletion confirmation |
| Team | Invitations/access assignment, roles/status, password reset and access revocation |
| AI | Authorizations, scopes, activity, endpoint copy and revocation |
| Custom Data and Audit | Field definitions/values, entity links, reusable values, feature flags, audit records |
| Settings | Workspace, Client App branding/assets/install links/QR, security, integrations, privacy |
| Forms and Funnels | Existing preview states and controls retained as previews |
| Shared states | Modal forms, confirmation dialogs, empty lists, errors, busy/disabled states, mobile drawers, fallback client portal |

## Figma evidence and layout translation

Source: https://www.figma.com/design/rqM8LzxapFvKGy1IaUl9q1/?node-id=4-6598

The target is the Components page. `get_design_context` was obtained for actual component nodes after the page-level call reported no selection. The JSON files beside this document contain direct Plugin API measurements. No Figma nodes were edited.

| Component / node | Measured layout | CSS contract |
| --- | --- | --- |
| Button 13:1598 | Horizontal, centered, HUG/HUG, padding 8/16, gap 10, radius 6, 14px Inter medium | inline-flex; auto width; min-height 40; 8px 16px; 6px radius |
| Input 13:1589 | Vertical, gap 6; horizontal field/action row gap 8; field expands | grid label/control/help; min-width 0; field width 100%; flex action row |
| Select 8:302 | Horizontal, gap 10, padding 8/12, expanding label, fixed 16px chevron | Native select retains behavior; 40px minimum height, 12px inset |
| Tabs 13:490 | Horizontal, padding 5, radius 6; tab padding 6/12 and radius 3 | flex tablist, content width, overflow scroll at narrow sizes |
| Tab card 13:491 | Vertical, padding 25, gap 25, radius 6 | Card tokens and stacked form content |
| Dialog 4:329 | Vertical, padding 24, radius 8; inner gap 32; field rows gap 16 | Responsive max-width dialog, 24px padding, content height, scroll overflow |
| Alert dialog 1:78 | Vertical, gap 16, padding 24, horizontal actions gap 8 | Shared modal with wrapping right-aligned footer |
| Popover 13:888 | Vertical, padding 17, gap 16, radius 6 | Scoped menu/popover surface, content height |
| Menus/command | Vertical groups; expanding rows; inset 5-8 | Sidebar/menu flex rows, icon fixed, label expands, badge hugs |
| Checkbox/radio/switch | Row gap 8; fixed control with hugging label | Preserve native controls and labels; accent token |
| Accordion 6:237 | Vertical; 24px container; rows 16px vertical padding | Existing disclosure behavior, restyled separators and spacing |

The library does not specify application breakpoints or a CRM sidebar/dashboard. Those are adaptations: flexible content at desktop, wrap toolbars, single-column forms/cards on phones, horizontally scroll wide data tables, preserve calendar/workflow coordinate systems. Canvas showcase coordinates are not layout instructions.

## Design tokens and plan

- Charcoal `#18181b`; raised charcoal `#27272a`; white `#ffffff`; canvas `#fafafa`; purple `#6757e8`; lavender `#eeeafd`.
- Inter for controls/body/headings, 14/20 body, 12/16 metadata, 18/28 card titles, 24/32 page titles; tabular numbers for metrics.
- Controls 6px corners, cards/dialogs 8px, badges 4px, avatars round. No decorative glow or glass layer.
- Preserve branded tenant overrides and appearance selection. Shared tokens feed every CRM module.
- Reuse existing components and class contracts; put the new visual system in a dedicated CRM stylesheet rather than rewriting working product logic.

```text
Desktop: [navigation 248] [page title | filters/actions]
                         [existing content in flexible rows]
Mobile:  [menu | title | action]
         [wrapping filters]
         [stacked content / scrollable table]
         [existing quick navigation]
```

Review against brief: a marketing-oriented hero, decorative motion, and replacement graphs would undermine this task. Use the reference's practical control proportions and preserve the application's screen structure and calculations.

## Validation

Baseline screenshots and interactive review use the actual CrmApp in an isolated local Vite harness with synthetic fixtures and blocked external writes. This distinguishes visual/interaction checks from live provider validation. Typecheck, lint, repository tests, build, feature-inventory comparison, and responsive browser checks are recorded after implementation.

### Completed checks

- `npm run typecheck` and `npm run lint`: passed.
- `npm test`: 703 tests passed, zero failures; includes production build and Miniflare CRM integration tests with tenant isolation.
- `npm run build`: passed independently.
- `node scripts/verify-ui-preservation.mjs`: 41 source files checked; 479 event handlers, 97 request expressions, 557 field attributes and 5 chart markup sites preserved. Dashboard source is byte-for-byte unchanged. See `preservation-result.json`.
- Browser sweep: all 26 agency tabs at 1440px and 390px, light and dark (104 screen cases). No runtime errors or document overflow. Text, field values/attributes, SVG paths and inline graph data match with the redesign stylesheet enabled and disabled. See `audit.json`.
- Interactive checks at 1440px, 390px and 320px: all 16 Add Lead fields remain present, dialog focus stays inside, Escape closes, command search opens/closes, approved client tabs remain restricted, agency-only navigation is rejected for clients, other-client data stays absent, and empty Dashboard charts retain their empty state. See `interactions.json`.
- Visually reviewed desktop/mobile Dashboard, list/card layouts, dark surfaces, pipeline scrolling and dialogs against the measured Figma component rules. The reference is a component library, so application compositions and breakpoints are adaptations rather than screenshot copies.

The existing theme test expected a dark logo in a charcoal sidebar although the original app already rendered the light logo. Its visual assertions now reflect the existing logo behavior and the new theme tokens; security assertions were retained.

### Scope of verification

Source preservation and automated coverage provide regression evidence, not proof that every external service operation succeeds. OAuth handoffs, live Stripe/Google/Meta/CallRail/Twilio operations, messaging, billing, and provider-hosted embedded UI were not exercised against production accounts. Disconnected-provider and error/empty surfaces were reviewed locally. No production data was changed and nothing was deployed.

The ignored `work/ui-review` directory contains the synthetic browser harness, screenshots and command logs from this review. Durable evidence is recorded beside this document. To repeat the source comparison, run `node scripts/verify-ui-preservation.mjs` from the repository root.
