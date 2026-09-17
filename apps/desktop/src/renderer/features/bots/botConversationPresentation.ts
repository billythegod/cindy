import { extractRenderedMarkdownImageTargets } from '@/components/chat/markdownImageTargets';
import type { ChatMessage } from '@/lib/makerChatStore';
import {
  isCompletedAssistantMessage,
  type MessageRenderItem,
  type RenderItem,
  type WorkGroupChildItem,
} from '@/components/chat/messageWorkGroups';

function isProse(item: RenderItem): item is MessageRenderItem {
  return item.type === 'message' && item.message.role === 'assistant'
    && !item.message.systemCardType;
}

function hasAttachments(message: ChatMessage): boolean {
  return Boolean(message.images?.length || message.files?.length);
}

/** Unwrap local groups, but preserve lazy history ownership and its load/retry API.
 * Thinking is deliberately excluded: this disclosure is public execution history.
 */
function publicItems(items: readonly RenderItem[]): RenderItem[] {
  return items.flatMap((item): RenderItem[] => {
    if (item.type === 'message' && item.message.role === 'thinking') return [];
    if (item.type !== 'work_group') return [item];
    const children = publicItems(item.children) as WorkGroupChildItem[];
    return item.deferred ? [{ ...item, children }] : children;
  });
}

/** A presentation-only projection. Never mutate messages or infer intent from prose.
 * isFinal from the adapters closes a text block, not a turn (Pi/Claude can call
 * another tool afterwards). Reuse the normal work-group turn seal, keeping all
 * unsealed prose in the disclosure while running. The composer owns live action
 * feedback. On stop/error or old history without a seal, expose the last useful
 * prose so an answer or plain-text question cannot disappear permanently.
 */
export function simplifyBotRenderItems(
  items: readonly RenderItem[],
  isStreaming: boolean,
): RenderItem[] {
  const result: RenderItem[] = [];
  let turn: RenderItem[] = [];
  const flushTurn = (active: boolean) => {
    let lastProse = -1;
    for (let index = 0; index < turn.length; index += 1) {
      const item = turn[index];
      if (isProse(item) && item.message.content.trim()) lastProse = index;
    }
    let work: WorkGroupChildItem[] = [];
    const flushWork = () => {
      if (!work.length) return;
      // Do not wrap an existing lazy group: it owns expansion and historical ids.
      result.push(work.length === 1 && work[0].type === 'work_group' ? work[0] : {
        type: 'work_group',
        key: `work-bot-${work[0].key}`,
        children: work,
        isStreaming: active,
      });
      work = [];
    };
    turn.forEach((item, index) => {
      if (item.type === 'agent_plan' || item.type === 'turn_changes') return;
      if (item.type === 'message' && item.message.isSyntheticTrigger) return;
      if (isProse(item)) {
        if (!item.message.content.trim() && !hasAttachments(item.message)) return;
        if (!isCompletedAssistantMessage(item.message)
          && !hasAttachments(item.message) && (active || index !== lastProse)
          && extractRenderedMarkdownImageTargets(item.message.content).length === 0) {
          work.push(item);
          return;
        }
      }
      if (item.type === 'tool_segment' || item.type === 'agent_task' || item.type === 'work_group') {
        work.push(item);
        return;
      }
      flushWork();
      // Includes authorization, answered questions, errors and all delivery cards.
      result.push(item);
    });
    flushWork();
    turn = [];
  };

  for (const item of publicItems(items)) {
    if (item.type === 'message' && item.message.role === 'user'
      && item.message.delivery !== 'steer') {
      flushTurn(false);
      if (!item.message.isSyntheticTrigger) result.push(item);
    } else {
      turn.push(item);
    }
  }
  flushTurn(isStreaming);
  return result;
}
