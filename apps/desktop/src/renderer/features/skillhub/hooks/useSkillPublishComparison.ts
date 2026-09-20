import { useEffect, useState } from 'react';
import { getDataOwnerGeneration, isDataOwnerGenerationCurrent } from '@/contexts/dataOwnerGeneration';
import type { SkillhubPublishComparison } from '../../../../shared/skillhubPublishComparison';

export type PublishComparisonState = SkillhubPublishComparison | { status: 'checking' };
const listeners = new Set<(path?: string) => void>();
let revision = 0;
let lastFocusRefresh = 0;
let active = 0;
const queue: Array<() => void> = [];
const inFlight = new Map<string, Promise<SkillhubPublishComparison>>();

export function invalidatePublishComparison(path?: string): void {
  revision++;
  listeners.forEach((listener) => listener(path));
}

function onFocus(): void {
  if (document.visibilityState === 'hidden' || Date.now() - lastFocusRefresh < 200) return;
  lastFocusRefresh = Date.now();
  invalidatePublishComparison();
}

function drain(): void {
  while (active < 3 && queue.length) queue.shift()?.();
}

function compare(key: string, skillId: string, absolutePath: string, current: () => boolean) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const operation = new Promise<SkillhubPublishComparison>((resolve) => {
    queue.push(() => {
      if (!current()) { resolve({ status: 'unavailable' }); return; }
      active++;
      Promise.resolve().then(() => window.electronAPI.skillhub.comparePublished({ skillId, absolutePath }))
        .then((result) => resolve(result && ['same', 'different', 'not-owner', 'unavailable'].includes(result.status)
          ? result : { status: 'unavailable' }), () => resolve({ status: 'unavailable' }))
        .finally(() => { active--; drain(); });
    });
  }).finally(() => { inFlight.delete(key); });
  inFlight.set(key, operation);
  drain();
  return operation;
}

/** Fresh reads on mount, local mutations and focus; no background polling or cross-owner cache. */
export function useSkillPublishComparison(skill: SkillhubSkill | null) {
  const absolutePath = skill?.kind === 'skill' && !skill.builtIn ? skill.absolutePath : null;
  const skillId = skill?.id ?? '';
  const [refresh, setRefresh] = useState(revision);
  const owner = getDataOwnerGeneration();
  const key = JSON.stringify([
    owner, absolutePath, skillId, skill?.registrySkillName ?? skill?.name,
    skill?.registryEntry?.catalogScope, skill?.registryEntry?.version,
    skill?.registryEntry?.folderHash, skill?.registryEntry?.updatedAt, refresh,
  ]);
  const [result, setResult] = useState<{ key: string; value: PublishComparisonState } | null>(null);

  useEffect(() => {
    const listener = (path?: string) => {
      if (!path || path === absolutePath) setRefresh(revision);
    };
    if (!listeners.size) {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onFocus);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onFocus);
      }
    };
  }, [absolutePath]);

  useEffect(() => {
    if (!absolutePath) return;
    let cancelled = false;
    const current = () => !cancelled && isDataOwnerGenerationCurrent(owner);
    void compare(key, skillId, absolutePath, () => isDataOwnerGenerationCurrent(owner)).then((value) => {
      if (current()) setResult({ key, value });
    });
    return () => { cancelled = true; };
  }, [key, absolutePath, skillId, owner]);

  const comparison: PublishComparisonState = !absolutePath ? { status: 'not-owner' }
    : result?.key === key ? result.value : { status: 'checking' };
  return { comparison, refresh };
}
