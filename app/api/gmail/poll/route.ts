import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { query } from '@/lib/db';

function getGmailClient() {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth });
}

function parseFrom(from: string): { name: string | null; email: string } {
  // Handles: "First Last <email@example.com>" or just "email@example.com"
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].replace(/^"|"$/g, '').trim(), email: match[2].trim() };
  }
  return { name: null, email: from.trim() };
}

export async function GET() {
  try {
    const gmail = getGmailClient();

    // Find inbound emails received in the last 24 hours that the user has NOT replied to
    const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `in:inbox after:${since} -in:sent`,
      maxResults: 50,
    });

    const messages = listRes.data.messages ?? [];
    let added = 0;

    for (const msg of messages) {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Message-ID', 'In-Reply-To', 'References'],
      });

      const headers = full.data.payload?.headers ?? [];
      const get = (name: string) =>
        headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

      // Skip if this is a reply (has In-Reply-To header)
      if (get('In-Reply-To')) continue;

      const fromRaw = get('From');
      const subject = get('Subject');

      if (!fromRaw) continue;

      const { name, email } = parseFrom(fromRaw);

      // Skip if a contact with this email was already inserted today
      const existing = await query(
        `SELECT id FROM contacts
         WHERE contact = $1
           AND type = 'email'
           AND received_at >= CURRENT_DATE
         LIMIT 1`,
        [email]
      );

      if (existing.length > 0) continue;

      await query(
        `INSERT INTO contacts (name, contact, type, source, status, notes)
         VALUES ($1, $2, 'email', 'gmail', 'new', $3)`,
        [name, email, subject]
      );

      added++;
    }

    return NextResponse.json({ added, scanned: messages.length });
  } catch (err) {
    console.error('GET /api/gmail/poll error:', err);
    return NextResponse.json({ error: 'Failed to poll Gmail' }, { status: 500 });
  }
}
