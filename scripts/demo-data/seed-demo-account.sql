-- BrizBuilder DEMO sub-account: "DEMO — Summit Roofing Co".
-- Everything is fictional (example.com emails, 555-01xx phone numbers) and
-- lives under one client id, so demo-remove.sql deletes all of it.
-- Re-running this script replaces the demo data rather than duplicating it.
do $$
declare
  org uuid := '00000000-0000-4000-8000-000000000001';
  cid uuid := md5('brizbuilder-demo:client')::uuid;
  pipe uuid := '00000000-0000-4000-8000-000000000101';
  biz_phone text := '+15125550100';
  firsts text[] := array['Jordan','Casey','Alex','Morgan','Taylor','Riley','Jamie','Avery','Quinn','Drew','Parker','Reese','Skyler','Cameron','Logan','Hayden','Rowan','Emerson','Finley','Sawyer','Blake','Dakota','Elliot','Harper','Jesse','Kendall','Lane','Marley','Noel','Peyton','Remy','Sage','Tatum','Wren','Zion'];
  lasts text[] := array['Chen','Rivera','Patel','Nguyen','Brooks','Hayes','Coleman','Ortiz','Bennett','Foster','Graham','Hughes','Jensen','Kim','Lawson','Moreno','Nash','Owens','Price','Quintero','Ramsey','Shaw','Turner','Vargas','Walsh','Young','Abbott','Barnes','Carver','Dalton','Ellis','Fischer','Garner','Holt','Irwin'];
  streets text[] := array['Oak Ridge Dr','Cedar Ln','Maple St','Willow Bend','Pecan Grove Rd','Live Oak Way','Bluebonnet Trl','Mesquite Ct'];
  cities text[] := array['Austin','Round Rock','Cedar Park','Pflugerville','Georgetown','Leander'];
  zips text[] := array['78745','78664','78613','78660','78626','78641'];
  services text[] := array['Roof replacement','Storm damage repair','Roof leak repair','Gutter installation','Roof inspection','Shingle repair','Metal roof install','Skylight install'];
  sources text[] := array['Google Ads','Meta Ads','Website Form','Organic Search','Referral','Manual'];
  -- 23 won jobs totalling exactly $101,678.
  won_amounts int[] := array[8500,3200,12400,2750,6900,4100,15800,1950,5400,3600,7200,2300,4800,1850,3900,2150,1600,2600,3300,1200,2200,1350,2628];
  meta_campaigns text[] := array['120210000000000101','120210000000000202'];
  meta_adsets text[] := array['120210000000001101','120210000000001202'];
  meta_ads text[] := array['120210000000011101','120210000000011202','120210000000011203'];
  stage_for jsonb := '{"NEW":"00000000-0000-4000-8000-000000000201","UNRESPONSIVE":"00000000-0000-4000-8000-000000000202","CONTACTED":"00000000-0000-4000-8000-000000000203","QUALIFIED":"00000000-0000-4000-8000-000000000204","APPOINTMENT_BOOKED":"00000000-0000-4000-8000-000000000205","ESTIMATE_SENT":"00000000-0000-4000-8000-000000000206","WON":"00000000-0000-4000-8000-000000000207","LOST":"00000000-0000-4000-8000-000000000208","SPAM":"00000000-0000-4000-8000-000000000208"}';
  i int; j int; k int;
  st text; src text; fn text; ln text; svc text; ph text; em text;
  created timestamptz; won_at timestamptz; final_cents int; est_cents int;
  lead_id uuid; contact_id uuid; conv_id uuid; consent_id uuid; wf_id uuid; site_id uuid; form_id uuid;
  attribution jsonb; camp_idx int;
begin
  -- Replace any earlier demo run.
  delete from public.clients where id = cid;

  insert into public.clients (id, organization_id, business_name, slug, industry, website, phone, email, address, city, state, zip, time_zone, status, monthly_ad_budget_cents, assigned_account_manager, service_areas, notes)
  values (cid, org, 'DEMO — Summit Roofing Co', 'demo-summit-roofing', 'Roofing', 'https://summitroofing.example', biz_phone, 'office@summitroofing.example', '4100 Demo Commerce Blvd', 'Austin', 'TX', '78745', 'America/Chicago', 'active', 450000, 'LB Marketing', array['Austin','Round Rock','Cedar Park','Pflugerville','Georgetown'], 'DEMO DATA — every record in this sub-account is fictional and safe to delete. Created for testing.');

  insert into public.client_branding (client_id, organization_id, app_name, primary_color, accent_color, stale_lead_hours, hot_lead_score)
  values (cid, org, 'Summit Roofing', '#1f4e79', '#f28c28', 24, 80);

  -- Companies (property managers and HOAs).
  insert into public.companies (id, organization_id, client_id, name, industry, website, phone, email, city, state, tags, notes)
  select md5('demo:company:' || n)::uuid, org, cid, name, ind, 'https://' || lower(replace(name, ' ', '')) || '.example',
         '+1512555' || lpad((180 + n)::text, 4, '0'), 'office@' || lower(replace(name, ' ', '')) || '.example', 'Austin', 'TX', array['demo', tag], 'Demo company.'
  from (values (1,'Hill Country Property Mgmt','Property management','commercial'),(2,'Lakeway HOA','Homeowners association','hoa'),
               (3,'Riverside Apartments','Multifamily','commercial'),(4,'Brushy Creek HOA','Homeowners association','hoa'),
               (5,'Capital Realty Group','Real estate','partner'),(6,'Texan Insurance Adjusters','Insurance','partner')) as c(n, name, ind, tag);

  for i in 1..70 loop
    st := case
      when i <= 23 then 'WON' when i <= 33 then 'NEW' when i <= 41 then 'CONTACTED' when i <= 48 then 'QUALIFIED'
      when i <= 54 then 'APPOINTMENT_BOOKED' when i <= 60 then 'ESTIMATE_SENT' when i <= 66 then 'LOST'
      when i <= 68 then 'SPAM' else 'UNRESPONSIVE' end;
    src := sources[1 + (i % 6)];
    fn := firsts[1 + ((i - 1) % 35)];
    ln := lasts[1 + ((i * 7) % 35)];
    svc := services[1 + (i % 8)];
    ph := '+1512555' || lpad((100 + i)::text, 4, '0');
    em := lower(fn || '.' || ln || i) || '@example.com';
    lead_id := md5('demo:lead:' || i)::uuid;
    contact_id := md5('demo:contact:' || i)::uuid;

    if st = 'WON' then
      created := now() - make_interval(days => 3 + (i * 25) / 23, hours => (i * 5) % 24);
      final_cents := won_amounts[i] * 100;
      est_cents := final_cents + ((i % 4) - 1) * 25000;
      won_at := created + make_interval(days => 1 + i % 4);
    elsif st = 'NEW' then
      created := now() - make_interval(hours => 2 + (i - 23) * 11);
      final_cents := 0; est_cents := (3000 + (i * 977) % 12000) * 100; won_at := null;
    else
      created := now() - make_interval(days => 2 + (i * 13) % 52, hours => (i * 3) % 24);
      final_cents := 0; est_cents := (2500 + (i * 1231) % 14000) * 100; won_at := null;
    end if;

    -- Meta leads (i = 1, 7, 13, ...) alternate between the two campaigns.
    camp_idx := 1 + ((i / 6) % 2);
    attribution := case when src = 'Meta Ads' then jsonb_build_object(
        'utm_source', 'facebook', 'utm_medium', 'paid_social',
        'utm_campaign', meta_campaigns[camp_idx], 'utm_term', meta_adsets[camp_idx],
        'utm_content', case when camp_idx = 1 then meta_ads[1 + 2 * (i % 2)] else meta_ads[2] end)
      when src = 'Google Ads' then jsonb_build_object('utm_source', 'google', 'utm_medium', 'cpc', 'utm_campaign', 'roof-replacement-search')
      else '{}'::jsonb end;

    insert into public.contacts (id, organization_id, client_id, first_name, last_name, phone, email, address, city, state, zip, company, tags, marketing_consent, notes, lifetime_value_cents, last_interaction_at, created_at, updated_at)
    values (contact_id, org, cid, fn, ln, ph, em, (1000 + i * 37) || ' ' || streets[1 + (i % 8)], cities[1 + (i % 6)], 'TX', zips[1 + (i % 6)],
            case when i % 9 = 0 then 'Hill Country Property Mgmt' when i % 11 = 0 then 'Lakeway HOA' else null end,
            array['demo'] || case when st = 'WON' then array['customer'] else array['prospect'] end || case when i % 9 = 0 then array['commercial'] else array[]::text[] end,
            case when i % 3 = 0 then 'unknown' else 'granted' end, 'Demo contact.', final_cents,
            coalesce(won_at, created + interval '3 hours'), created, coalesce(won_at, created));

    insert into public.leads (id, organization_id, client_id, contact_id, pipeline_id, stage_id, service_requested, message, source, campaign, status, assigned_user,
                              estimated_value_cents, final_revenue_cents, appointment_date, lead_score, tags, consent_status, lost_reason,
                              last_contacted_at, first_contacted_at, next_follow_up_at, created_at, updated_at, attribution,
                              appointment_status, appointment_start, appointment_end, appointment_timezone, appointment_source)
    values (lead_id, org, cid, contact_id, pipe, (stage_for ->> st)::uuid, svc,
            case i % 4 when 0 then 'Noticed missing shingles after the storm. Can someone take a look this week?'
                       when 1 then 'Looking for a quote on ' || lower(svc) || '. House is about 2,400 sq ft.'
                       when 2 then 'Water stain on the ceiling in the upstairs bedroom.'
                       else 'Insurance adjuster asked us to get an estimate.' end,
            src, case src when 'Google Ads' then 'Roof Replacement — Search' when 'Meta Ads' then case camp_idx when 1 then 'Storm Season Leads' else 'Free Roof Inspection' end else null end,
            st::lead_status, case when i % 3 = 0 then 'Marcus (Sales)' else 'Dana (Office)' end,
            est_cents, case when st = 'WON' then final_cents else 0 end,
            case when st = 'APPOINTMENT_BOOKED' then date_trunc('day', now()) + make_interval(days => i - 48, hours => 9 + (i % 6))
                 when st = 'WON' then created + interval '1 day' else null end,
            40 + (i * 17) % 56,
            array['demo'] || case when i % 5 = 0 then array['hot'] else array[]::text[] end || case when src = 'Meta Ads' then array['storm-season'] else array[]::text[] end,
            case when i % 3 = 0 then 'unknown' else 'granted' end,
            case st when 'LOST' then (array['Went with another contractor','Price too high','Insurance denied the claim','Postponed until spring'])[1 + i % 4]
                    when 'SPAM' then 'Spam submission' else null end,
            case when st = 'NEW' then null else created + make_interval(mins => 20 + (i * 7) % 180) end,
            case when st = 'NEW' then null else created + make_interval(mins => 20 + (i * 7) % 180) end,
            case when st in ('CONTACTED','QUALIFIED','ESTIMATE_SENT','UNRESPONSIVE') then now() + make_interval(days => (i % 5) - 1) else null end,
            created, coalesce(won_at, created + interval '1 hour'), attribution,
            case when st = 'APPOINTMENT_BOOKED' then 'confirmed' else 'none' end,
            case when st = 'APPOINTMENT_BOOKED' then date_trunc('day', now()) + make_interval(days => i - 48, hours => 9 + (i % 6)) else null end,
            case when st = 'APPOINTMENT_BOOKED' then date_trunc('day', now()) + make_interval(days => i - 48, hours => 10 + (i % 6), mins => 30) else null end,
            case when st = 'APPOINTMENT_BOOKED' then 'America/Chicago' else null end,
            case when st = 'APPOINTMENT_BOOKED' then 'manual' else null end);

    -- Appointments: upcoming for booked leads, completed for most won jobs, no-shows for two lost.
    if st = 'APPOINTMENT_BOOKED' or (st = 'WON' and i <= 14) or i in (61, 62) then
      insert into public.appointments (id, organization_id, client_id, lead_id, contact_id, assigned_employee, service_type, starts_at, ends_at, status, notes, created_at, source, time_zone)
      values (md5('demo:appointment:' || i)::uuid, org, cid, lead_id, contact_id,
              case when i % 2 = 0 then 'Marcus (Sales)' else 'Luis (Estimator)' end, svc || ' estimate',
              case when st = 'APPOINTMENT_BOOKED' then date_trunc('day', now()) + make_interval(days => i - 48, hours => 9 + (i % 6))
                   else created + make_interval(days => 1, hours => 10) end,
              case when st = 'APPOINTMENT_BOOKED' then date_trunc('day', now()) + make_interval(days => i - 48, hours => 10 + (i % 6), mins => 30)
                   else created + make_interval(days => 1, hours => 11, mins => 30) end,
              case when st = 'APPOINTMENT_BOOKED' then case when i % 2 = 0 then 'CONFIRMED' else 'SCHEDULED' end
                   when st = 'WON' then 'COMPLETED' else 'NO_SHOW' end,
              'Demo appointment. Gate code 1234.', created, 'manual', 'America/Chicago');
    end if;

    -- Notes on the first 24 leads.
    if i <= 24 then
      insert into public.notes (id, organization_id, client_id, lead_id, contact_id, body, created_at)
      values (md5('demo:note:' || i)::uuid, org, cid, lead_id, contact_id,
              (array['Homeowner prefers text over calls. Dog in backyard.',
                     'Insurance claim #DEMO-' || (4400 + i) || ' approved. Adjuster visit done.',
                     'Wants architectural shingles in Weathered Wood. Sent 3 samples.',
                     'Signed contract on site. 50% deposit collected.'])[1 + i % 4],
              created + interval '2 hours');
    end if;
  end loop;

  -- Tasks: open follow-ups (some overdue), in progress and done.
  for i in 1..16 loop
    insert into public.tasks (id, organization_id, client_id, lead_id, contact_id, title, description, assignee, due_at, priority, status, created_at, completed_at)
    values (md5('demo:task:' || i)::uuid, org, cid, md5('demo:lead:' || (23 + i))::uuid, md5('demo:contact:' || (23 + i))::uuid,
            (array['Call back about estimate','Send roof inspection photos','Follow up on insurance claim','Confirm material delivery','Schedule final walkthrough','Text appointment reminder'])[1 + i % 6],
            'Demo task.', case when i % 2 = 0 then 'Marcus (Sales)' else 'Dana (Office)' end,
            now() + make_interval(days => (i % 7) - 2, hours => 9),
            (array['LOW','MEDIUM','HIGH','URGENT'])[1 + i % 4],
            case when i <= 9 then 'OPEN' when i <= 12 then 'IN_PROGRESS' else 'COMPLETED' end,
            now() - make_interval(days => 3 + i % 5),
            case when i > 12 then now() - make_interval(days => i % 3) else null end);
  end loop;

  -- Calls: 48 over the last 30 days; every fifth one missed, the newest missed ones still unanswered.
  for j in 1..48 loop
    i := 1 + ((j * 3) % 70);
    ph := '+1512555' || lpad((100 + i)::text, 4, '0');
    src := sources[1 + (i % 6)];
    insert into public.phone_calls (id, organization_id, client_id, contact_id, lead_id, provider_call_sid, provider_call_id, provider, direction,
                                    from_number, to_number, status, answered, answered_by, duration_seconds, started_at, ended_at,
                                    customer_phone, business_phone, customer_name, source, source_name, medium, call_summary,
                                    recording_available, handled_at, created_at, updated_at)
    values (md5('demo:call:' || j)::uuid, org, cid, md5('demo:contact:' || i)::uuid, md5('demo:lead:' || i)::uuid,
            'DEMO-CALL-' || lpad(j::text, 3, '0'), 'DEMO-CALL-' || lpad(j::text, 3, '0'), 'twilio', 'inbound',
            ph, biz_phone,
            case when j % 5 = 0 then 'no-answer' else 'completed' end,
            j % 5 <> 0, case when j % 5 = 0 then null else 'Dana (Office)' end,
            case when j % 5 = 0 then 0 else 45 + (j * 37) % 540 end,
            now() - make_interval(hours => j * 14 + 1),
            now() - make_interval(hours => j * 14 + 1) + make_interval(secs => case when j % 5 = 0 then 25 else 45 + (j * 37) % 540 end),
            ph, biz_phone, firsts[1 + ((i - 1) % 35)] || ' ' || lasts[1 + ((i * 7) % 35)],
            src, src, case when src in ('Google Ads','Meta Ads') then 'paid' else 'organic' end,
            case when j % 5 = 0 then null else
              (array['Caller asked for a replacement quote after hail damage. Booked an inspection for Thursday.',
                     'Existing customer checking on material delivery date. Confirmed for Monday.',
                     'Leak over the garage. Sent the estimator out the same afternoon.',
                     'Comparing three quotes. Asked about financing and warranty length.'])[1 + j % 4] end,
            false,
            case when j % 5 = 0 and j > 15 then now() - make_interval(hours => j * 14 - 2) else null end,
            now() - make_interval(hours => j * 14 + 1), now() - make_interval(hours => j * 14 + 1));
  end loop;

  -- Text conversations with ten contacts.
  for i in 24..33 loop
    conv_id := md5('demo:conversation:' || i)::uuid;
    contact_id := md5('demo:contact:' || i)::uuid;
    ph := '+1512555' || lpad((100 + i)::text, 4, '0');
    insert into public.conversations (id, organization_id, client_id, contact_id, channel, status, assigned_to, unread_count, last_message_at, created_at, updated_at)
    values (conv_id, org, cid, contact_id, 'sms', 'open', 'Dana (Office)', case when i % 3 = 0 then 1 else 0 end,
            now() - make_interval(hours => (i - 23) * 5), now() - make_interval(days => 2), now() - make_interval(hours => (i - 23) * 5));
    for k in 1..4 loop
      insert into public.messages (id, organization_id, client_id, conversation_id, contact_id, provider_message_sid, direction, channel, from_number, to_number, body, status, sent_at, delivered_at, created_at, updated_at)
      values (md5('demo:message:' || i || ':' || k)::uuid, org, cid, conv_id, contact_id, 'DEMO-SMS-' || i || '-' || k,
              case when k % 2 = 1 then 'inbound' else 'outbound' end, 'sms',
              case when k % 2 = 1 then ph else biz_phone end, case when k % 2 = 1 then biz_phone else ph end,
              (array['Hi, is this Summit Roofing? We have a leak after last night''s storm.',
                     'Sorry to hear that! We can have someone out tomorrow between 9 and 11. Does that work?',
                     'Tomorrow works. Thank you!',
                     'Great — Luis will text when he is on the way. Reply STOP to opt out.'])[k],
              case when k % 2 = 1 then 'received' else 'delivered' end,
              now() - make_interval(hours => (i - 23) * 5 + (4 - k)),
              case when k % 2 = 0 then now() - make_interval(hours => (i - 23) * 5 + (4 - k)) else null end,
              now() - make_interval(hours => (i - 23) * 5 + (4 - k)), now() - make_interval(hours => (i - 23) * 5 + (4 - k)));
    end loop;
  end loop;

  -- Reviews: settings with sending OFF, plus a history of requests to past customers.
  insert into public.review_settings (organization_id, client_id, sms_enabled, default_sms_template, follow_up_enabled, follow_up_template, follow_up_delay_hours, quiet_hours_start, quiet_hours_end, daily_limit, notification_emails)
  values (org, cid, false, 'Thanks for choosing Summit Roofing, {first_name}! Would you leave us a quick review? {review_link}', false,
          'Just a reminder, {first_name} — your review helps other homeowners find us. {review_link}', 72, '21:00', '08:00', 25, array['office@summitroofing.example']);
  for i in 1..8 loop
    consent_id := md5('demo:consent:' || i)::uuid;
    insert into public.contact_message_consents (id, organization_id, client_id, contact_id, channel, purpose, status, source, evidence, policy_version, captured_by_email, captured_at)
    values (consent_id, org, cid, md5('demo:contact:' || i)::uuid, 'sms', 'review_request', 'granted', 'manual',
            jsonb_build_object('note', 'Demo consent recorded at job completion'), 'demo-v1', 'demo@example.com', now() - make_interval(days => 20 - i));
    insert into public.review_requests (id, organization_id, client_id, contact_id, consent_id, channel, status, request_kind, trigger_source, idempotency_key, message_body, requested_by_email, sent_at, delivered_at, failed_at, error_message, created_at, updated_at)
    values (md5('demo:review:' || i)::uuid, org, cid, md5('demo:contact:' || i)::uuid, consent_id, 'sms',
            case when i <= 6 then 'delivered' when i = 7 then 'failed' else 'sent' end, 'initial', 'job_completed', 'demo-review-' || i,
            'Thanks for choosing Summit Roofing! Would you leave us a quick review?', 'demo@example.com',
            now() - make_interval(days => 18 - i), case when i <= 6 then now() - make_interval(days => 18 - i) else null end,
            case when i = 7 then now() - make_interval(days => 11) else null end, case when i = 7 then 'Demo: carrier rejected the message' else null end,
            now() - make_interval(days => 18 - i), now() - make_interval(days => 18 - i));
  end loop;

  -- Website, pages and a contact form with submissions from the website leads.
  site_id := md5('demo:website')::uuid;
  insert into public.websites (id, organization_id, client_id, name, domain, status, brand_colors, seo, analytics)
  values (site_id, org, cid, 'Summit Roofing website', 'summitroofing.example', 'connected',
          '{"primary":"#1f4e79","accent":"#f28c28"}', '{"title":"Summit Roofing | Austin Roof Repair & Replacement"}', '{}');
  insert into public.website_pages (id, website_id, organization_id, client_id, title, slug, page_type, published_at)
  values (md5('demo:page:1')::uuid, site_id, org, cid, 'Home', 'home', 'home', now() - interval '60 days'),
         (md5('demo:page:2')::uuid, site_id, org, cid, 'Free Roof Inspection', 'free-inspection', 'landing', now() - interval '45 days'),
         (md5('demo:page:3')::uuid, site_id, org, cid, 'Storm Damage Repair', 'storm-damage', 'service', now() - interval '30 days');
  form_id := md5('demo:form')::uuid;
  insert into public.forms (id, organization_id, client_id, website_id, name, schema)
  values (form_id, org, cid, site_id, 'Free inspection request', '{"fields":["name","phone","email","address","message"]}');
  insert into public.form_submissions (id, organization_id, client_id, form_id, payload, lead_id, created_at)
  select md5('demo:submission:' || l.n)::uuid, org, cid, form_id,
         jsonb_build_object('name', c.first_name || ' ' || c.last_name, 'phone', c.phone, 'email', c.email, 'message', ld.message),
         ld.id, ld.created_at
  from generate_series(1, 70) as l(n)
  join public.leads ld on ld.id = md5('demo:lead:' || l.n)::uuid and ld.source = 'Website Form'
  join public.contacts c on c.id = ld.contact_id;

  -- Automations: one active workflow that only creates a task and adds a tag
  -- (no texts), and one draft that would text a missed caller.
  wf_id := md5('demo:workflow:1')::uuid;
  insert into public.workflows (id, organization_id, client_id, name, description, status, trigger_key, current_version, published_version, created_by_email)
  values (wf_id, org, cid, 'New lead follow-up', 'Creates a call-back task and tags every new lead.', 'active', 'lead.created', 1, 1, 'demo@example.com');
  insert into public.workflow_versions (organization_id, client_id, workflow_id, version, graph, validation_errors, created_by_email)
  values (org, cid, wf_id, 1, '{"nodes":[
      {"id":"trigger","type":"trigger","label":"New lead","x":80,"y":160,"config":{"eventKey":"lead.created"}},
      {"id":"task","type":"create_task","label":"Call back within 15 minutes","x":360,"y":120,"config":{"title":"Call back new lead within 15 minutes"}},
      {"id":"tag","type":"add_tag","label":"Tag as new","x":360,"y":240,"config":{"tag":"needs-callback"}}],
    "edges":[{"id":"e1","source":"trigger","target":"task","branch":"always"},{"id":"e2","source":"trigger","target":"tag","branch":"always"}]}', '[]', 'demo@example.com');
  insert into public.workflow_runs (organization_id, client_id, workflow_id, version, trigger_key, trigger_event_id, status, is_test, input, output, started_at, completed_at)
  select org, cid, wf_id, 1, 'lead.created', 'demo-run-' || n, 'completed', true,
         jsonb_build_object('leadId', md5('demo:lead:' || (23 + n))::uuid), '{"steps":2}', now() - make_interval(days => n), now() - make_interval(days => n) + interval '2 seconds'
  from generate_series(1, 3) as g(n);

  wf_id := md5('demo:workflow:2')::uuid;
  insert into public.workflows (id, organization_id, client_id, name, description, status, trigger_key, current_version, published_version, created_by_email)
  values (wf_id, org, cid, 'Missed call text-back (draft)', 'Texts a caller we missed. Draft — needs Twilio connected before it can run.', 'draft', 'call.missed', 1, null, 'demo@example.com');
  insert into public.workflow_versions (organization_id, client_id, workflow_id, version, graph, validation_errors, created_by_email)
  values (org, cid, wf_id, 1, '{"nodes":[
      {"id":"trigger","type":"trigger","label":"Missed call","x":80,"y":160,"config":{"eventKey":"call.missed"}},
      {"id":"sms","type":"send_sms","label":"Text the caller","x":360,"y":160,"config":{"message":"Sorry we missed your call! This is Summit Roofing — how can we help?"}}],
    "edges":[{"id":"e1","source":"trigger","target":"sms","branch":"always"}]}', '[]', 'demo@example.com');

  -- Meta ad spend for the last 30 days, matching the campaign ids on the Meta leads.
  insert into public.meta_ad_insights (organization_id, client_id, date_start, campaign_id, campaign_name, adset_id, ad_id, ad_name, spend_cents, impressions, clicks, synced_at)
  select org, cid, (current_date - d), a.campaign_id, a.campaign_name, a.adset_id, a.ad_id, a.ad_name,
         a.base_spend + ((d * 731) % 2400), a.base_impr + (d * 97) % 900, a.base_clicks + (d * 13) % 30, now()
  from generate_series(0, 30) as s(d)
  cross join (values
    ('120210000000000101','Storm Season Leads','120210000000001101','120210000000011101','Hail damage video', 5200, 2600, 34),
    ('120210000000000101','Storm Season Leads','120210000000001101','120210000000011203','Before/after carousel', 3100, 1800, 22),
    ('120210000000000202','Free Roof Inspection','120210000000001202','120210000000011202','Free inspection offer', 4400, 2300, 28)
  ) as a(campaign_id, campaign_name, adset_id, ad_id, ad_name, base_spend, base_impr, base_clicks);
end
$$;
