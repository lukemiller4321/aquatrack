import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const contacts = await query(
      'SELECT * FROM contacts ORDER BY received_at DESC'
    );
    return NextResponse.json(contacts);
  } catch (err) {
    console.error('GET /api/contacts error:', err);
    return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, contact, type, source, notes, voicemail } = body;

    if (!contact || !type) {
      return NextResponse.json(
        { error: 'contact and type are required' },
        { status: 400 }
      );
    }

    const rows = await query(
      `INSERT INTO contacts (name, contact, type, source, notes, voicemail)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name ?? null, contact, type, source ?? null, notes ?? '', voicemail ?? false]
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    console.error('POST /api/contacts error:', err);
    return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 });
  }
}
