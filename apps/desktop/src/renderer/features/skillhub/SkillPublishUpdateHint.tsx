import { useTranslation } from 'react-i18next';
import { useSkillPublishComparison } from './hooks/useSkillPublishComparison';

export function SkillPublishUpdateHint({ skill, knownCreator }: { skill: SkillhubSkill; knownCreator?: boolean }) {
  const { t } = useTranslation();
  const { comparison } = useSkillPublishComparison(skill);
  if (comparison.status !== 'different' && comparison.status !== 'unavailable') return null;
  if (comparison.status === 'unavailable' && !knownCreator) return null;
  return (
    <span className="text-12 leading-4 text-[var(--text-secondary)]">
      {t(comparison.status === 'unavailable' ? 'skillhub.publishComparison.unavailable'
        : comparison.pending ? 'skillhub.publishComparison.pendingChanges' : 'skillhub.publishComparison.updateAvailable')}
    </span>
  );
}
