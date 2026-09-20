/** Local comparison state; hashes never represent permission or package authenticity. */
export interface SkillhubContentChange {
  path: string;
  kind: 'added' | 'removed' | 'modified';
  isBinary: boolean;
  oldContent: string;
  newContent: string;
  oldSize: number;
  newSize: number;
}

export interface SkillhubPublishComparisonParams {
  absolutePath: string;
  skillId?: string;
  includeDiff?: boolean;
}

export type SkillhubPublishComparison =
  | { status: 'not-owner' }
  | { status: 'unavailable' }
  | {
      status: 'same' | 'different';
      version: string;
      pending: boolean;
      changes?: SkillhubContentChange[];
    };
