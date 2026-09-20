// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as { membershipKind: 'org' } | null,
  t: (key: string) => key,
  store: {
    skills: [] as SkillhubSkill[],
    projects: [],
    bootstrapped: true,
    learnSkillEnabled: false,
    syncResults: new Map(),
  },
  market: {
    items: [], loading: false, loadingMore: false, hasMore: false,
    resolvedScope: 'market', resolvedMine: false, categoryFilter: 'all',
    setSearchQuery: vi.fn(), setSortBy: vi.fn(), setCatalogScope: vi.fn(),
    setCategoryFilter: vi.fn(), setVisibility: vi.fn(), loadMore: vi.fn(), reload: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../hooks/useSkillhub', () => ({ useSkillhub: () => mocks.store, refresh: vi.fn() }));
vi.mock('../hooks/useMarketList', () => ({
  MARKET_PAGE_SIZE: 24,
  useMarketList: () => mocks.market,
  useCategoryList: () => ({ categories: [] }),
}));
vi.mock('../hooks/useMarketManagement', () => ({
  useMarketManagement: () => ({}), MarketManagementDialogs: () => null,
}));
vi.mock('../components/InstallTargetPicker', () => ({ InstallTargetPicker: () => null }));
vi.mock('../SkillhubMarketPreviewPanel', () => ({ SkillhubMarketPreviewPanel: () => null }));

import { SkillhubHomeView } from '../SkillhubHomeView';
import { useSkillhubHomeNavigation } from '../hooks/useSkillhubHomeNavigation';

function NavigationControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>
      <button onClick={() => navigate(-1)}>Browser Back</button>
      <button onClick={() => navigate('/away')}>Leave catalog</button>
    </>
  );
}

// Exercise the same return action used by the detail page without mounting its file editor/IPC.
function DetailNavigation() {
  const { backToCatalog } = useSkillhubHomeNavigation();
  return <button onClick={backToCatalog}>Detail Back</button>;
}

function renderCatalog(entry: string | { pathname: string; state: unknown } = '/skillhub/local') {
  return render(
    <MemoryRouter initialEntries={['/before', entry]}>
      <NavigationControls />
      <Routes>
        <Route path="/skillhub/local" element={<SkillhubHomeView />} />
        <Route path="/skillhub/local/:kind/global/:name" element={<DetailNavigation />} />
        <Route path="/skillhub/local/:kind/project/:hash/:name" element={<DetailNavigation />} />
        <Route path="/settings" element={<SkillhubHomeView embedded />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
}

function expectTab(tab: 'local' | 'public' | 'organization') {
  const name = tab === 'local' ? 'skillhub.home.local' : `skillhub.home.catalogFilter.${tab}`;
  expect(screen.getByRole('radio', { name }).getAttribute('aria-checked')).toBe('true');
}

function selectLocalAndSearch() {
  fireEvent.click(screen.getByRole('radio', { name: 'skillhub.home.local' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'skillhub.home.search' }), {
    target: { value: 'calendar' },
  });
}

beforeEach(() => {
  mocks.user = null;
  mocks.store.skills = ['calendar-tools', 'design-tools'].map((name) => ({
    id: name, urlKey: `skill/global/${name}`, name, engine: 'claude-code',
    kind: 'skill', scope: 'global', linkedEngines: [],
    absolutePath: `/skills/${name}`, mdPath: `/skills/${name}/SKILL.md`, files: [],
    registryEntry: null,
  }));
});
afterEach(cleanup);

describe('Skill home navigation', () => {
  it('still opens a fresh catalog on Public', () => {
    renderCatalog();
    expectTab('public');
  });

  it.each([
    ['global', 'Detail Back'], ['global', 'Browser Back'],
    ['project', 'Detail Back'], ['project', 'Browser Back'],
  ] as const)('restores Local and search after opening a %s skill and using %s', async (scope, back) => {
    if (scope === 'project') {
      Object.assign(mocks.store.skills[0], { scope, projectRoot: '/repo', projectHash: 'repo-hash' });
    }
    renderCatalog();
    selectLocalAndSearch();
    fireEvent.click(screen.getByRole('button', { name: /calendar-tools/ }));
    expect(screen.queryByRole('radio', { name: 'skillhub.home.local' })).toBeNull();
    expect(screen.getByTestId('location').textContent).toContain(`/skill/${scope}/`);

    fireEvent.click(screen.getByRole('button', { name: back }));
    await waitFor(() => expectTab('local'));
    expect((screen.getByRole('textbox', { name: 'skillhub.home.search' }) as HTMLInputElement).value)
      .toBe('calendar');
    expect(screen.getByRole('button', { name: /calendar-tools/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /design-tools/ })).toBeNull();
  });

  it('does not add browser history entries while changing filters or typing', () => {
    renderCatalog();
    selectLocalAndSearch();
    fireEvent.change(screen.getByRole('textbox', { name: 'skillhub.home.search' }), {
      target: { value: 'calendar-tools' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(screen.getByTestId('location').textContent).toBe('/before');
  });

  it('preserves the Settings URL and restores its local catalog state on detail return', async () => {
    renderCatalog('/settings?tab=ghosts#catalog');
    selectLocalAndSearch();
    expect(screen.getByTestId('location').textContent).toBe('/settings?tab=ghosts#catalog');
    fireEvent.click(screen.getByRole('button', { name: /calendar-tools/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Detail Back' }));
    await waitFor(() => expectTab('local'));
    expect(screen.getByTestId('location').textContent).toBe('/skillhub/local');
    expect((screen.getByRole('textbox', { name: 'skillhub.home.search' }) as HTMLInputElement).value)
      .toBe('calendar');
  });

  it.each([true, false])('restores an organization tab only while it is available (%s)', async (stillMember) => {
    mocks.user = { membershipKind: 'org' };
    renderCatalog();
    fireEvent.click(screen.getByRole('radio', { name: 'skillhub.home.catalogFilter.organization' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave catalog' }));
    if (!stillMember) mocks.user = null;
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    await waitFor(() => expectTab(stillMember ? 'organization' : 'public'));
  });

  it('keeps the market return destination for existing market detail entries', () => {
    renderCatalog({
      pathname: '/skillhub/local/skill/global/calendar-tools',
      state: { from: '/skillhub/market', resetHistory: true },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Detail Back' }));
    expect(screen.getByTestId('location').textContent).toBe('/skillhub/market');
  });
});
