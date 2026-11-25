import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { InboxButton } from '@/components/AppHeader/InboxButton';
import { Section, Row } from '@/components/Section/Section';
import { useDataSourceContext } from '@/data/sources/DataSourceContext';
import { sampleUserProfile } from '@/data/userProfile';
import { claudeReady, loadClaudeConfig } from '@/data/claudeConfig';
import {
  applyTherapyOverrides,
  clearTherapyOverrides,
  loadTherapyOverrides,
  saveTherapyOverrides,
  type EditableTherapy,
} from '@/data/loopTherapyStore';
import type {
  HealthConnection,
  UserProfile,
} from '@/data/types';
import { ProfileHeader } from './ProfileHeader';
import { Foundations } from './Foundations';
import { LearnedProfile } from './LearnedProfile';
import { HealthConnections } from './HealthConnections';
import { ClinicalSettings } from './ClinicalSettings';
import { LoopScheduleSettings } from './LoopScheduleSettings';
import { NotificationSettings } from './NotificationSettings';

const sourceLabel: Record<string, string> = {
  mock: 'Sample data',
  healthkit: 'Apple Health',
  nightscout: 'Nightscout',
};

export function Profile() {
  const navigate = useNavigate();
  const { activeKind, refresh } = useDataSourceContext();
  const [profile, setProfile] = useState<UserProfile>(sampleUserProfile);

  // Therapy values are device-local overrides layered over the profile
  // defaults, so they survive a reload.
  const [therapy, setTherapy] = useState<EditableTherapy | null>(
    loadTherapyOverrides,
  );

  const clinical = applyTherapyOverrides(profile.clinical, therapy);

  const saveTherapy = (next: EditableTherapy) => {
    saveTherapyOverrides(next);
    setTherapy(next);
    // Time in range is scored against the target inside the data source, so a
    // new target only reaches the dashboard on the next read.
    void refresh();
  };

  const resetTherapy = () => {
    clearTherapyOverrides();
    setTherapy(null);
    void refresh();
  };

  const setFoundations = (next: Pick<UserProfile, 'ageRange' | 'typicalRoutine'>) =>
    setProfile((p) => ({ ...p, ...next }));

  const toggleConnection = (id: HealthConnection['id']) => {
    setProfile((p) => ({
      ...p,
      connections: p.connections.map((c) =>
        c.id === id ? { ...c, connected: !c.connected } : c,
      ),
    }));
  };

  return (
    <>
      <AppHeader title="Profile" rightAction={<InboxButton />} />
      <main className="screen">
        <ProfileHeader profile={profile} />

        <Section
          label="Data"
          title="Sources"
          description="Where LoopStack reads glucose, insulin, and carb history from."
        >
          <Row
            label="Active source"
            value={sourceLabel[activeKind] ?? activeKind}
            onClick={() => navigate('/app/settings/sources')}
            trailing={<span aria-hidden>›</span>}
          />
        </Section>

        <Section label="Understanding" title="Ask your data" description="Review a food's last three sittings or recurring weekday lows. Evidence is calculated on this device; Claude can explain it when connected.">
          <Row label="Open evidence review" value="Meals · weekday hours" onClick={() => navigate('/app/chat')} trailing={<span aria-hidden>›</span>} />
        </Section>

        <Section label="Care team" title="Clinic report" description="A PDF of observed patterns and your Loop settings for appointments — a brief read or the full settings overview.">
          <Row label="Build a report" value="Brief · Full" onClick={() => navigate('/app/report')} trailing={<span aria-hidden>›</span>} />
        </Section>

        <Section label="AI" title="Claude" description="Connect a Claude API key for discussion notes and evidence explanations. Nothing is sent without a preview.">
          <Row label="Claude connection" value={claudeReady(loadClaudeConfig()) ? 'On' : 'Off'} onClick={() => navigate('/app/settings/claude')} trailing={<span aria-hidden>›</span>} />
        </Section>

        <Foundations profile={profile} onChange={setFoundations} />

        <HealthConnections
          connections={profile.connections}
          fitness={profile.fitness}
          onToggle={toggleConnection}
        />

        <ClinicalSettings
          clinical={clinical}
          onChange={saveTherapy}
          onReset={resetTherapy}
          edited={therapy != null}
        />

        <LoopScheduleSettings onChanged={refresh} />

        <NotificationSettings />

        <LearnedProfile dietary={profile.dietary} />
      </main>
    </>
  );
}
