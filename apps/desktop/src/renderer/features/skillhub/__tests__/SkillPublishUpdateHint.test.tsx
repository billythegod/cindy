// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SkillPublishComparisonNotice, SkillPublishUpdateHint } from '../SkillPublishUpdateHint';
import type { PublishComparisonState } from '../hooks/useSkillPublishComparison';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../hooks/useSkillPublishComparison', () => ({
  useSkillPublishComparison: () => ({ comparison: { status: 'unavailable' } }),
}));
afterEach(cleanup);

it.each([false, undefined, true])('shows unavailable hints only for a confirmed creator (%s)', (isCreator) => {
  // A non-creator may still have canManage; legacy responses omit isCreator entirely.
  const info = { canManage: true, isCreator };
  render(<>
    <SkillPublishComparisonNotice comparison={{ status: 'unavailable' }} isCreator={info.isCreator} />
    <SkillPublishUpdateHint skill={{} as SkillhubSkill} knownCreator={info.isCreator} />
  </>);
  expect(screen.queryAllByText('skillhub.publishComparison.unavailable')).toHaveLength(isCreator === true ? 2 : 0);
});

it.each<PublishComparisonState>([
  { status: 'checking' }, { status: 'not-owner' },
  { status: 'same', version: '1.0.0', pending: false },
  { status: 'different', version: '1.1.0', pending: true },
])('does not show an unavailable notice for $status', (comparison) => {
  render(<SkillPublishComparisonNotice comparison={comparison} isCreator />);
  expect(screen.queryByText('skillhub.publishComparison.unavailable')).toBeNull();
});

it('removes the notice when author identity changes', () => {
  const { rerender } = render(<SkillPublishComparisonNotice comparison={{ status: 'unavailable' }} isCreator />);
  expect(screen.getByText('skillhub.publishComparison.unavailable')).toBeTruthy();
  rerender(<SkillPublishComparisonNotice comparison={{ status: 'unavailable' }} isCreator={false} />);
  expect(screen.queryByText('skillhub.publishComparison.unavailable')).toBeNull();
});
