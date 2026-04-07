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
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].replace(/^"|"$/g, '').trim(), email: match[2].trim() };
  }
  return { name: null, email: from.trim() };
}

/**
 * Returns true for any POSH missed call email. Matches if ANY condition is true:
 * - Subject contains "posh assist" anywhere, including after Fwd:/Fw:/Re: prefixes
 * - Sender is noreply@posh.com (direct or forwarded)
 * - Body contains "noreply@posh.com" (forwarded email footer/header)
 * - Body contains "Caller's Name" (POSH-specific label)
 */
function isPosh(from: string, subject: string, body: string): boolean {
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();
  const lowerFrom = from.toLowerCase();
  return (
    lowerSubject.includes('posh assist') ||
    lowerFrom.includes('noreply@posh.com') ||
    lowerBody.includes('noreply@posh.com') ||
    lowerBody.includes("caller's name")
  );
}

/**
 * Parse a POSH email body. Expected label-per-line format:
 *   Caller's Name
 *   John Smith
 *   Phone Number
 *   (555) 867-5309
 *   Transcription
 *   Hi I'd like to enroll my daughter...
 */
function parsePoshBody(body: string): { name: string | null; phone: string | null; notes: string } {
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let name: string | null = null;
  let phone: string | null = null;
  let transcription: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].toLowerCase();
    const next = lines[i + 1] ?? '';

    if (label === "caller's name" && next) {
      name = next;
      i++;
    } else if (label === 'phone number' && next) {
      phone = next;
      i++;
    } else if (label === 'transcription' && next) {
      transcription = next;
      i++;
    }
  }

  return { name, phone, notes: transcription ?? 'POSH missed call' };
}

/** Decode a base64url-encoded Gmail message part body */
function decodeBody(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

/** Recursively extract plain text from Gmail message parts */
function extractPlainText(payload: { mimeType?: string | null; body?: { data?: string | null } | null; parts?: unknown[] | null }): string {
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBody(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainText(part as typeof payload);
      if (text) return text;
    }
  }
  return '';
}

export async function GET() {
  try {
    const gmail = getGmailClient();

    const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `in:inbox after:${since} -in:sent`,
      maxResults: 50,
    });

    const messages = listRes.data.messages ?? [];
    let added = 0;

    for (const msg of messages) {
      const messageId = msg.id!;

      // Dedup by Gmail message ID — never process the same email twice
      const existing = await query(
        `SELECT id FROM contacts WHERE gmail_message_id = $1 LIMIT 1`,
        [messageId]
      );
      if (existing.length > 0) {
        console.log(`[gmail/poll] dedup skipped message ID: ${messageId}`);
        continue;
      }

      const full = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
        metadataHeaders: ['From', 'Subject', 'In-Reply-To'],
      });

      const headers = full.data.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

      if (getHeader('In-Reply-To')) continue;

      const fromRaw = getHeader('From');
      const subject = getHeader('Subject');

      if (!fromRaw) continue;

      console.log(`[gmail/poll] scanning: from="${fromRaw}" subject="${subject}"`);

      const body = extractPlainText(full.data.payload ?? {});

      if (isPosh(fromRaw, subject, body)) {
        console.log(`[gmail/poll] POSH detected: from="${fromRaw}" subject="${subject}"`);

        const { name, phone, notes } = parsePoshBody(body);
        const contact = phone ?? fromRaw;

        await query(
          `INSERT INTO contacts (name, contact, type, source, status, notes, gmail_message_id)
           VALUES ($1, $2, 'call', 'posh', 'new', $3, $4)`,
          [name, contact, notes, messageId]
        );
      } else {
        // --- Regular inbound email ---
        const { name, email } = parseFrom(fromRaw);

        await query(
          `INSERT INTO contacts (name, contact, type, source, status, notes, gmail_message_id)
           VALUES ($1, $2, 'email', 'gmail', 'new', $3, $4)`,
          [name, email, subject, messageId]
        );
      }

      added++;
    }

    return NextResponse.json({ added, scanned: messages.length });
  } catch (err) {
    console.error('GET /api/gmail/poll error:', err);
    return NextResponse.json({ error: 'Failed to poll Gmail' }, { status: 500 });
  }
}
