import { installServerCatalog } from '@cindy/model-providers';
import { getDataOwnerGeneration, isDataOwnerGenerationCurrent } from '@/contexts/dataOwnerGeneration';

let generation = 0;
/** Renderer adapter lookups consume the same public publication already accepted by main. */
export async function loadProviderPresetCatalog() {
  const request = ++generation;
  const owner = getDataOwnerGeneration();
  const result = await window.electronAPI.maker.listProviderPresets();
  if (request === generation && isDataOwnerGenerationCurrent(owner) && result.catalog) installServerCatalog(result.catalog);
  return result;
}
