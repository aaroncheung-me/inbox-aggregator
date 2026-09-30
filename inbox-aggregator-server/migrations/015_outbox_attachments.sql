-- 015: a private storage bucket for files attached to emails being sent.
-- A file waits here only until its email is sent or undone (anything left
-- behind is removed after a day). The bucket is private: only the server,
-- with its service key, can read or write it.
-- Run this before restarting or deploying the server that uses it.
-- Paste this whole file into the Supabase SQL Editor and run it.

insert into storage.buckets (id, name, public, file_size_limit)
values ('outbox-attachments', 'outbox-attachments', false, 26214400) -- 25 MB
on conflict (id) do nothing;
