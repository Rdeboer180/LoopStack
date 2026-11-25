import { describe, expect, it } from 'vitest';
import { nextStep, parseSaved, progressWords, shouldOpenOnLaunch, stepStates, type Facts } from './setup';

const none: Facts = { nightscout: false, sample: false, layoutChosen: false, careContact: false, claude: false, github: false };

describe('setup steps', () => {
  it('a fresh Mac has every step to do', () => {
    const s = stepStates(none, []);
    expect(Object.values(s).every((v) => v === 'todo')).toBe(true);
    expect(progressWords(s)).toBe('Setup · 0 of 4');
    expect(nextStep(s)).toBe('data');
  });
  it('sample data counts as the data step; either tool connection counts as tools', () => {
    expect(stepStates({ ...none, sample: true }, []).data).toBe('done');
    expect(stepStates({ ...none, github: true }, []).tools).toBe('done');
    expect(stepStates({ ...none, claude: true }, []).tools).toBe('done');
  });
  it('a skipped step stays skipped until it is really done', () => {
    expect(stepStates(none, ['care']).care).toBe('skipped');
    expect(stepStates({ ...none, careContact: true }, ['care']).care).toBe('done');
    expect(nextStep(stepStates({ ...none, nightscout: true }, ['dashboard']))).toBe('care');
  });
  it('opens on its own only on a first run with a bridge and nothing connected', () => {
    const fresh = parseSaved(null);
    expect(shouldOpenOnLaunch(fresh, none, true)).toBe(true);
    expect(shouldOpenOnLaunch(fresh, none, false)).toBe(false); // the browser preview
    expect(shouldOpenOnLaunch({ ...fresh, closed: true }, none, true)).toBe(false);
    expect(shouldOpenOnLaunch(fresh, { ...none, nightscout: true }, true)).toBe(false);
  });
  it('reads stored choices defensively', () => {
    expect(parseSaved({ closed: true, skipped: ['care', 'nope', 7], layoutChosen: 'yes' })).toEqual({ closed: true, skipped: ['care'], layoutChosen: false });
    expect(parseSaved('x')).toEqual({ closed: false, skipped: [], layoutChosen: false });
  });
});
