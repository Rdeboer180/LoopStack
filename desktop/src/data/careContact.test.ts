import { describe, expect, it } from 'vitest';
import { cleanNotes, isEmail, mailto, notesBody, noteTime, splitAtVisit } from './careContact';

describe('care-team email', () => {
  it('recovers from malformed stored contacts and notes', () => {
    expect(isEmail(undefined)).toBe(false);
    expect(isEmail({})).toBe(false);
    expect(cleanNotes(null)).toEqual([]);
    expect(cleanNotes({ text: 'broken' })).toEqual([]);
    expect(cleanNotes([null, { text: 'missing id' }, { id: 'a', date: 'Nov 21', text: 'A note' }])).toEqual([{ id: 'a', date: 'Nov 21', text: 'A note' }]);
  });
  it('takes one plain address only', () => {
    expect(isEmail('clinic@example.org')).toBe(true);
    expect(isEmail(' clinic@example.org ')).toBe(true);
    expect(isEmail('clinic@example')).toBe(false);
    expect(isEmail('a@b.org, c@d.org')).toBe(false);
    expect(isEmail('a@b.org;c@d.org')).toBe(false);
    expect(isEmail('Dr O <a@b.org>')).toBe(false);
    expect(isEmail('')).toBe(false);
  });

  it('encodes subject and body so they cannot add recipients or headers', () => {
    const href = mailto('clinic@example.org', 'Notes & more', 'line one\n\n&cc=x@evil.org&bcc=y@evil.org')!;
    expect(href.startsWith('mailto:clinic@example.org?subject=Notes%20%26%20more&body=')).toBe(true);
    expect(href).not.toMatch(/&cc=|&bcc=/);
    expect(decodeURIComponent(href.split('body=')[1])).toBe('line one\n\n&cc=x@evil.org&bcc=y@evil.org');
  });

  it('refuses a bad address and leaves out an empty body', () => {
    expect(mailto('not an email', 's', 'b')).toBeNull();
    expect(mailto('clinic@example.org', 'Hi', '')).toBe('mailto:clinic@example.org?subject=Hi');
  });

  it('puts notes oldest first, dated', () => {
    expect(notesBody([{ id: '1', date: 'Nov 2', text: 'a' }, { id: '2', date: 'Nov 9', text: 'b' }])).toBe('Nov 2: a\n\nNov 9: b');
  });
});

describe('notes since the last visit', () => {
  const at = (ms: number) => ({ id: `${ms.toString(36)}abcd`, date: 'Nov 1', text: 'x' });
  it('reads the time from the note, or from an older note’s id', () => {
    expect(noteTime({ id: 'zz', date: 'Nov 1', text: 'x', at: 5 })).toBe(5);
    expect(noteTime(at(1_700_000_000_000))).toBe(1_700_000_000_000);
  });
  it('shows every note until a visit is marked, then only the ones after it', () => {
    const notes = [at(100), at(200), at(300)];
    expect(splitAtVisit(notes, null).since).toHaveLength(3);
    const s = splitAtVisit(notes, 200);
    expect(s.since.map(noteTime)).toEqual([300]);
    expect(s.before.map(noteTime)).toEqual([100, 200]);
  });
});
