import { useState } from 'react';
import { Linking, Pressable, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { BotCollaborationMeta } from '@cindy/maker-shared/botCollaboration';
import { Text } from '@/components/AppText';
import { useThemedStyles, type ThemeColors } from '@/theme';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { classifyChatPathLinkTarget, resolveChatAbsPath } from '@/session/chatPathCandidate';
import { parseMobileMarkdown } from '@/session/messageMarkdown';

function resultLinks(text: string): Array<{ label: string; url: string }> {
  const seen = new Set<string>();
  const links: Array<{ label: string; url: string }> = [];
  for (const block of parseMobileMarkdown(text)) {
    if (!('inlines' in block)) continue;
    for (const inline of block.inlines) {
      if (inline.type !== 'link' && inline.type !== 'image') continue;
      if (seen.has(inline.url)) continue;
      seen.add(inline.url);
      links.push({ label: (inline.type === 'image' ? inline.alt : inline.text) || inline.url, url: inline.url });
    }
  }
  return links;
}

export function CompanionTaskResultCard({ meta, deviceId }: { meta: BotCollaborationMeta; deviceId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [showError, setShowError] = useState(false);
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const result = meta.result;
  if (!result) return null;
  const links = resultLinks(result.text);
  const openResultLink = (url: string) => {
    const path = classifyChatPathLinkTarget(url);
    if (path && meta.childSessionId) {
      router.push({ pathname: '/files/preview/[sessionId]', params: {
        sessionId: meta.childSessionId, deviceId,
        absPath: resolveChatAbsPath(path.href, result.workingDir ?? ''),
      } });
    } else if (/^https?:\/\//i.test(url)) {
      void Linking.openURL(url).catch(() => undefined);
    }
  };
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.action}>
      <Text numberOfLines={2} style={styles.title}>{meta.objective}</Text>
      <Text style={styles.secondary}>{t(`devices.companions.status.${result.status}`)} · {t('devices.companions.viewResult')}</Text>
    </Pressable>
    {expanded && <View style={styles.content}>
      <Text selectable style={styles.body}>{result.text || t('devices.companions.noWrittenResult')}</Text>
      {links.filter(({ url }) => /^https?:\/\//i.test(url) || (meta.childSessionId && classifyChatPathLinkTarget(url))).map(({ label, url }) =>
        <Pressable key={url} accessibilityRole="link" style={styles.action} onPress={() => openResultLink(url)}>
          <Text style={styles.title}>{label}</Text>
        </Pressable>)}
      {result.error && <View>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showError }} onPress={() => setShowError(!showError)} style={styles.action}>
          <Text style={styles.secondary}>{t('interaction.companion.details')}</Text>
        </Pressable>
        {showError && <Text selectable style={styles.secondary}>{result.error}</Text>}
      </View>}
      {result.artifacts.map((artifact) => <Pressable key={artifact.absolutePath} accessibilityRole="button" style={styles.action}
        onPress={() => router.push({ pathname: '/files/preview/[sessionId]', params: { sessionId: meta.childSessionId ?? '', deviceId, absPath: artifact.absolutePath } })}>
        <Text style={styles.title}>{artifact.absolutePath.split(/[\\/]/).pop()}</Text>
      </Pressable>)}
    </View>}
  </View>;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.container, overflow: 'hidden' },
  action: { minHeight: 44, padding: spacing.md, gap: spacing.xs },
  title: { fontSize: typeScale.body, color: colors.textPrimary },
  secondary: { fontSize: typeScale.caption, color: colors.textSecondary },
  body: { fontSize: typeScale.body, color: colors.textPrimary },
  content: { padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
