# AquaTrack — Swim School Missed Contact Tracker

## Stack
- Next.js 14 (App Router)
- PostgreSQL via pg package (connected to Supabase)
- Tailwind CSS

## What this app does
Automatically captures missed phone calls (via Twilio webhook) and unanswered
emails (via Gmail API polling) into a PostgreSQL database. Staff use the
dashboard to follow up and track leads through to enrollment.

## Project structure
- /app                  → Next.js App Router pages and API routes
- /app/api/twilio       → Twilio webhook handler
- /app/api/gmail        → Gmail polling endpoint
- /app/api/contacts     → CRUD for contacts table
- /components           → React UI components
- /lib/db.ts            → PostgreSQL connection + query helpers

## Environment variables
DATABASE_URL is in .env.local and connects to Supabase PostgreSQL

## Key rules
- All DB queries go through /lib/db.ts — no inline SQL in components
- Use server components for data fetching where possible
- Contacts table is the single source of truth