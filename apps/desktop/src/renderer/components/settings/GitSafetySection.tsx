import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { useGitSafetySettings } from '@/hooks/useGitSafetySettings';
import type { GitSafetyMode } from '@/lib/gitSafetySettingsStore';

export function GitSafetySection() {
  const { t } = useTranslation();
  const { mode, setMode } = useGitSafetySettings();
  const [saving, setSaving] = useState(false);

  const handleModeChange = useCallback(
    (next: GitSafetyMode) => {
      if (saving) return;
      setSaving(true);
      void setMode(next)
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : t('settings.gitSafety.saveFailed'));
        })
        .finally(() => setSaving(false));
    },
    [saving, setMode, t],
  );

  return (
    <div className="flex flex-col gap-[14px]">
      <h2 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">
        {t('settings.gitSafety.title')}
      </h2>

      <div
        className={cn(
          'flex flex-col gap-3 rounded-xl p-5',
          'bg-[var(--settings-theme-card-bg)]',
          'border border-[var(--settings-theme-card-border)]',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-13 font-medium text-[var(--settings-section-sublabel)]">
              {t('settings.gitSafety.autoSnapshotTitle')}
            </p>
            <p className="text-12 leading-[1.4] text-[var(--settings-section-sublabel)] opacity-70">{t('settings.gitSafety.description')}</p>
          </div>

          <select
            value={mode}
            onChange={(event) => handleModeChange(event.target.value as GitSafetyMode)}
            disabled={saving}
            aria-label={t('settings.gitSafety.modeAria')}
            className="min-w-[180px] rounded-lg border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] px-2 py-1.5 text-12 text-[var(--settings-section-sublabel)]"
          >
            <option value="off">{t('settings.gitSafety.modes.off')}</option>
            <option value="existing-git">{t('settings.gitSafety.modes.existingGit')}</option>
            <option value="all-projects">{t('settings.gitSafety.modes.allProjects')}</option>
          </select>
        </div>
      </div>
    </div>
  );
}
