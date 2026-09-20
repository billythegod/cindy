import { skillhubCatalogKey, type SkillhubCatalogScope } from '../../../../shared/skillhubCatalog';

export function marketLocalCopies(skills: readonly SkillhubSkill[], market: {
  name: string; isMine: boolean; catalogScope?: SkillhubCatalogScope;
}): SkillhubSkill[] {
  return skills.filter((local) => {
    const name = local.registryEntry ? local.registrySkillName ?? local.name : local.name;
    if (local.kind !== 'skill' || name !== market.name) return false;
    return local.registryEntry
      ? skillhubCatalogKey(name, local.registryEntry.catalogScope) === skillhubCatalogKey(market.name, market.catalogScope)
      : market.isMine;
  }).sort((left, right) => Number(right.scope === 'global') - Number(left.scope === 'global'));
}
