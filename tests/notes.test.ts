import { describe, expect, it } from 'vitest';
import { canModifyNote, NOTE_MAX, noteExcerpt } from '@/lib/notes';

describe('who may change a note', () => {
  it('lets the author and any admin, nobody else', () => {
    expect(canModifyNote('u1', { id: 'u1', role: 'logistics' })).toBe(true);
    expect(canModifyNote('u1', { id: 'u2', role: 'marketing' })).toBe(false);
    expect(canModifyNote('u1', { id: 'u2', role: 'admin' })).toBe(true);
  });

  it('leaves a note whose author is gone to admins', () => {
    expect(canModifyNote(null, { id: 'u1', role: 'logistics' })).toBe(false);
    expect(canModifyNote(null, { id: 'u1', role: 'admin' })).toBe(true);
  });

  it('gives an unknown role nothing, even for its own note', () => {
    expect(canModifyNote('u1', { id: 'u2', role: 'staff' })).toBe(false);
  });
});

describe('note excerpts', () => {
  it('takes the first line and cuts a long one', () => {
    expect(noteExcerpt('  Pack as a gift.\nCall before sending.')).toBe('Pack as a gift.');
    const cut = noteExcerpt('x'.repeat(200), 20);
    expect(cut).toHaveLength(20);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('keeps notes within the limit the forms use', () => {
    expect(NOTE_MAX).toBe(2000);
  });
});
