import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, notes, voicemail } = body;

    const rows = await query(
      `UPDATE contacts
       SET status    = COALESCE($1, status),
           notes     = COALESCE($2, notes),
           voicemail = COALESCE($3, voicemail),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status ?? null, notes ?? null, voicemail ?? null, id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/contacts/[id] error:', err);
    return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;

    const rows = await query(
      'DELETE FROM contacts WHERE id = $1 RETURNING id',
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /api/contacts/[id] error:', err);
    return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 });
  }
}
