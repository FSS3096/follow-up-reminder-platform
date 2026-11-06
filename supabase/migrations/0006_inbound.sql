-- 0006_inbound.sql : support for the inbound WhatsApp webhook (Brief B7).
-- Rate limit for the fixed out-of-scope auto-reply (max one per patient per 6 h) must survive
-- serverless cold starts, so it lives in the database. Stores a timestamp only, never a message.
alter table patients add column if not exists last_auto_reply_at timestamptz;

-- Delivery-status lookups from /api/webhooks/twilio/status.
create index if not exists reminders_provider_sid_idx on reminders (provider_message_sid)
  where provider_message_sid is not null;
