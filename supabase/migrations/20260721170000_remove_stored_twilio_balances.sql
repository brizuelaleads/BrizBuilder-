-- Twilio parent balances are shared financial data. Fetch them live only from
-- the owner-authorized server endpoint and never expose them through tenant rows.
update public.provider_connections
set
  public_config = public_config - 'balance' - 'balanceStatus',
  updated_at = now()
where
  provider = 'twilio'
  and (public_config ? 'balance' or public_config ? 'balanceStatus');
