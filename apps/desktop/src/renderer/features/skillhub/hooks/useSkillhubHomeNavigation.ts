import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type { HomeCatalogTab } from '../lib/homeMarketFilter';
import { buildLocalSkillRoute } from '../lib/localRoutes';

interface HomeViewState {
  catalogTab: HomeCatalogTab;
  query: string;
}

interface SkillhubNavigationState {
  from?: string;
  resetHistory?: boolean;
  skillhubHome?: HomeViewState;
}

/** Keep list state on the history entry so both detail Back and browser Back restore it. */
export function useSkillhubHomeNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as SkillhubNavigationState | null;
  const savedTab = navState?.skillhubHome?.catalogTab;
  const catalogTab: HomeCatalogTab = savedTab === 'local' || savedTab === 'organization'
    ? savedTab
    : 'public';
  const query = typeof navState?.skillhubHome?.query === 'string' ? navState.skillhubHome.query : '';

  const updateHomeState = useCallback((patch: Partial<HomeViewState>) => {
    // Replace the current entry: typing or changing tabs must not add Back steps.
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: { ...location.state, skillhubHome: { catalogTab, query, ...patch } },
    });
  }, [catalogTab, location, navigate, query]);

  const setCatalogTab = useCallback((tab: HomeCatalogTab) => {
    updateHomeState({ catalogTab: tab });
  }, [updateHomeState]);
  const setQuery = useCallback((value: string) => {
    updateHomeState({ query: value });
  }, [updateHomeState]);

  const openLocalSkill = (skill: Parameters<typeof buildLocalSkillRoute>[0]) => {
    navigate(buildLocalSkillRoute(skill), {
      state: {
        from: '/skillhub/local',
        resetHistory: true,
        skillhubHome: { catalogTab, query },
      } satisfies SkillhubNavigationState,
    });
  };

  const backToCatalog = () => {
    const target = navState?.from === '/skillhub/market' ? '/skillhub/market' : '/skillhub/local';
    navigate(target, { state: { skillhubHome: navState?.skillhubHome } });
  };

  return { catalogTab, query, setCatalogTab, setQuery, openLocalSkill, backToCatalog };
}
