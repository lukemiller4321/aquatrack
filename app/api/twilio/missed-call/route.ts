import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { query } from '@/lib/db';

const TWIML_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">You have reached Patti's Swim School. We missed your call and will get back to you shortly. Please leave a message after the tone.</Say>
  <Record maxLength="120" transcribe="true" transcribeCallback="/api/twilio/missed-call" />
</Response>`;

/** Extract a name from common voicemail openers like "hi this is John Smith" */
function extractName(text: string): string | null {
  const match = text.match(/(?:this is|my name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  return match ? match[1].trim() : null;
}

export async function POST(request: NextRequest) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.error('Missing Twilio credentials');
    return new NextResponse('Server misconfiguration', { status: 500 });
  }

  // Verify Twilio signature
  const twilioSignature = request.headers.get('x-twilio-signature') ?? '';
  const url = request.url;
  const body = await request.text();

  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    params[key] = value;
  }

  if (process.env.NODE_ENV !== 'development') {
    const isValid = twilio.validateRequest(authToken, twilioSignature, url, params);
    if (!isValid) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  console.log('[twilio/missed-call] incoming params:', params);

  const transcriptionText = params['TranscriptionText'];
  const callSid = params['CallSid'];

  // Transcription callback — update notes and extract name on the matching row
  if (transcriptionText && callSid) {
    try {
      const name = extractName(transcriptionText);
      await query(
        `UPDATE contacts
         SET notes      = $1,
             name       = COALESCE(name, $2),
             voicemail  = true,
             updated_at = NOW()
         WHERE call_sid = $3`,
        [transcriptionText, name, callSid]
      );
    } catch (err) {
      console.error('Failed to update transcription:', err);
    }
    return new NextResponse('', { status: 204 });
  }

  // Inbound call — insert new contact with CallSid and voicemail flag
  const from = params['From'];
  const direction = params['Direction'];
  const recordingUrl = params['RecordingUrl'] ?? null;

  if (direction === 'inbound') {
    try {
      const existing = await query(
        `SELECT id FROM contacts
         WHERE contact = $1 AND received_at > NOW() - INTERVAL '5 minutes'
         LIMIT 1`,
        [from]
      );

      if (existing.length === 0) {
        await query(
          `INSERT INTO contacts (contact, type, source, status, call_sid, voicemail)
           VALUES ($1, 'call', 'twilio', 'new', $2, $3)`,
          [from, callSid ?? null, recordingUrl !== null]
        );
      } else {
        console.log('[twilio/missed-call] duplicate suppressed for', from);
      }
    } catch (err) {
      console.error('Failed to insert missed call contact:', err);
    }
  }

  return new NextResponse(TWIML_RESPONSE, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
