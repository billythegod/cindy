// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PublishComparisonState } from '../../hooks/useSkillPublishComparison';
import type { MarketSkill } from '../../hooks/useMarketList';
import { MarketPublishUpdateHint } from '../MarketPublishUpdateHint';
const state = vi.hoisted(() => ({ skills: [] as SkillhubSkill[], comparison: { status: 'not-owner' } as PublishComparisonState, compare: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useSkillhub', () => ({ useSkillhub: () => ({ skills: state.skills }) }));
vi.mock('../../hooks/useSkillPublishComparison', () => ({ useSkillPublishComparison: (local: SkillhubSkill | null) => {
  state.compare(local); return { comparison: state.comparison };
} }));
const market = { name: 'demo', isMine: true, catalogScope: 'market' } as MarketSkill;
const copy = (id: string, scope: 'global' | 'project', catalogScope = 'market') => ({ id, kind: 'skill', name: 'demo', scope,
  absolutePath: `/skills/${id}`, registryEntry: { version: '1.0.0', catalogScope } }) as SkillhubSkill;
beforeEach(() => {
  state.skills = [copy('project', 'project'), copy('global', 'global'), copy('other-catalog', 'global', 'team')];
  state.comparison = { status: 'different', version: '2.0.0', pending: false, localChanges: 'modified' };
  state.compare.mockClear();
});
afterEach(cleanup);

it('opens publication for the card primary copy without opening card details', () => {
  const publish = vi.fn(); const open = vi.fn();
  render(<div onClick={open}><MarketPublishUpdateHint skill={market} onPublish={publish} /></div>);
  fireEvent.click(screen.getByRole('button'));
  expect(publish).toHaveBeenCalledWith(state.skills[1]);
  expect(open).not.toHaveBeenCalled();
});
it('binds comparison and publication to the detail-selected project copy', () => {
  const publish = vi.fn();
  render(<MarketPublishUpdateHint skill={market} localSkill={state.skills[0]} onPublish={publish} />);
  fireEvent.click(screen.getByRole('button'));
  expect(state.compare).toHaveBeenLastCalledWith(state.skills[0]);
  expect(publish).toHaveBeenCalledWith(state.skills[0]);
});
it.each<PublishComparisonState>([
  { status: 'not-owner' }, { status: 'unavailable' }, { status: 'checking' },
  { status: 'same', version: '2.0.0', pending: false },
  { status: 'different', version: '2.0.0', pending: false, localChanges: 'unchanged' },
  { status: 'different', version: '2.0.0', pending: false, localChanges: 'unknown' },
])('does not turn $status into a publish reminder', (comparison) => {
  state.comparison = comparison;
  render(<MarketPublishUpdateHint skill={market} onPublish={vi.fn()} />);
  expect(screen.queryByRole('button')).toBeNull();
});
it('cannot publish while a download update is running', () => {
  const publish = vi.fn();
  render(<MarketPublishUpdateHint skill={market} onPublish={publish} disabled />);
  fireEvent.click(screen.getByRole('button'));
  expect(publish).not.toHaveBeenCalled();
});
