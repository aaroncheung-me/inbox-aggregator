-- 014: an email signature for each account (plain text), added to emails
-- written in the app from that address. Set in the app's Settings page.
-- Run this before restarting or deploying the server: the server reads it.
-- Paste this whole file into the Supabase SQL Editor and run it.

alter table public.accounts add column if not exists signature text;
