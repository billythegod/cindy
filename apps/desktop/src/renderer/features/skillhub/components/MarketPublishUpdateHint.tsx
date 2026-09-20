import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { MarketSkill } from '../hooks/useMarketList';
import { useSkillhub } from '../hooks/useSkillhub';
import { useSkillPublishComparison } from '../hooks/useSkillPublishComparison';
import { marketLocalCopies } from '../lib/marketLocalCopies';
import { hasPublishableChanges } from '../lib/publishUpdateState';

export function MarketPublishUpdateHint({ skill, localSkill, disabled, onPublish }: {
  skill: MarketSkill; localSkill?: SkillhubSkill | null; disabled?: boolean; onPublish: (local: SkillhubSkill) => void;
}) {
  const { t } = useTranslation();
  const { skills } = useSkillhub();
  const local = localSkill === undefined ? marketLocalCopies(skills, skill)[0] ?? null : localSkill;
  // Main verifies isCreator and management rights; organizational ownership alone is insufficient.
  const { comparison } = useSkillPublishComparison(local);
  if (!local || !hasPublishableChanges(comparison)) return null;
  return (
    <span className="inline-flex shrink-0" onClick={(event) => event.stopPropagation()}>
      <Button variant="secondary" disabled={disabled} className="px-3" onClick={() => onPublish(local)}>
        {t('skillhub.publishComparison.updateAvailable')}
      </Button>
    </span>
  );
}
