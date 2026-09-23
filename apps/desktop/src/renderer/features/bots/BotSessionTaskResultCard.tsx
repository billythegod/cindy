import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { readBotCollaborationMeta } from '../../../shared/botCollaboration';
import { ChatSessionFileProvider, useChatSessionFile } from '@/components/chat/ChatSessionFileContext';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer';

/** A frozen execution receipt; expanding it never restarts or fetches the task. */
export function BotSessionTaskResultCard({ data }: { data?: Record<string, unknown> }) {
  const { t } = useTranslation();
  const fileContext = useChatSessionFile();
  const card = readBotCollaborationMeta(data?.botCollaboration);
  if (card?.role !== 'delegation-result' || !card.result) return null;
  const { result } = card;
  return (
    <details className="my-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] text-14 text-[var(--text-primary)]">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 py-2 focus-visible:outline focus-visible:outline-2">
        <FileText size={16} className="shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{card.objective}</span>
        <span className="shrink-0 text-12 text-[var(--text-secondary)]">{t(`bots.collab.status.${result.status}`)}</span>
        <span className="shrink-0 text-12">{t('bots.collab.viewResult')}</span>
      </summary>
      <div className="space-y-2 border-t border-[var(--border-default)] px-3 py-3">
        <p className="whitespace-pre-wrap break-words">{result.text || t('bots.collab.noWrittenResult')}</p>
        <ChatSessionFileProvider value={{ ...fileContext, sessionId: card.childSessionId ?? undefined }}>
          {result.artifacts.map((artifact) => (
            <MarkdownRenderer key={artifact.absolutePath} workingDir="" currentSessionId={card.childSessionId ?? undefined}
              content={`[${artifact.absolutePath.split(/[\\/]/).pop()?.replace(/[\[\]\\]/g, '\\$&') ?? t('bots.collab.viewResult')}](<${encodeURI(artifact.absolutePath).replace(/[<>?#]/g, encodeURIComponent)}>)`} />
          ))}
        </ChatSessionFileProvider>
      </div>
    </details>
  );
}
