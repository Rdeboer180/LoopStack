import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module without types
import { blocksChange, checkCopy } from '../../../scripts/system/core.mjs';
import { REPORT_STYLES, styleById } from './reportStyles';

describe('care-team report styles', () => {
  it('defaults to LoopStack, also for an unknown saved value', () => {
    expect(REPORT_STYLES[0].id).toBe('loopstack');
    expect(styleById('nope').id).toBe('loopstack');
    expect(styleById(null).id).toBe('loopstack');
  });
  it('every style covers glucose, Loop and settings, with unique sections', () => {
    for (const s of REPORT_STYLES) {
      const blocks = s.sections.flatMap((x) => x.blocks);
      for (const need of ['agp', 'insulin', 'explorer', 'timeline']) expect(blocks, `${s.id} ${need}`).toContain(need);
      expect(new Set(s.sections.map((x) => x.id)).size).toBe(s.sections.length);
    }
  });
  it('every style shows the Loop settings in effect, and where the care team’s input helps, in its first section', () => {
    for (const s of REPORT_STYLES) {
      expect(s.sections.flatMap((x) => x.blocks), s.id).toContain('therapy');
      expect(s.sections[0].blocks, s.id).toContain('tldr');
    }
  });
  it('no block appears twice in a style (it would print twice too)', () => {
    for (const s of REPORT_STYLES) {
      const blocks = s.sections.flatMap((x) => x.blocks);
      expect(new Set(blocks).size, s.id).toBe(blocks.length);
    }
  });
  it('settings are always Loop’s own, never named after a pump or device', () => {
    for (const s of REPORT_STYLES) {
      for (const sec of s.sections) expect(sec.label, s.id).not.toMatch(/pump|device/i);
      const home = s.sections.find((x) => x.blocks.includes('therapy'))!;
      expect(home.label, s.id).toMatch(/Loop|Settings timeline/);
    }
  });
  it('never borrows another system’s automation name for Loop', () => {
    for (const s of REPORT_STYLES) expect(JSON.stringify(s.terms)).not.toMatch(/SmartGuard|Control-IQ|Automated Mode/i);
  });
  it('every borrowed layout says it isn’t theirs, and the copy passes the gate', () => {
    for (const s of REPORT_STYLES.slice(1)) {
      expect(s.note).toMatch(/Not made by or affiliated with/);
      const blocking = (checkCopy(`${s.label}. ${s.note}`) as { code: string }[]).filter((f) => blocksChange(f));
      expect(blocking, s.id).toEqual([]);
    }
  });
});
