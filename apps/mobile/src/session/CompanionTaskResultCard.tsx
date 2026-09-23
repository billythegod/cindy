import { useState } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { BotCollaborationMeta } from '@cindy/maker-shared/botCollaboration';
import { Text } from '@/components/AppText';
import { useThemedStyles, type ThemeColors } from '@/theme';
import { radius, spacing, typeScale } from '@/theme/tokens';

export function CompanionTaskResultCard({ meta, deviceId }: { meta: BotCollaborationMeta; deviceId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [showError, setShowError] = useState(false);
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const result = meta.result;
  if (!result) return null;
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.action}>
      <Text numberOfLines={2} style={styles.title}>{meta.objective}</Text>
      <Text style={styles.secondary}>{t(`devices.companions.status.${result.status}`)} · {t('devices.companions.viewResult')}</Text>
    </Pressable>
    {expanded && <View style={styles.content}>
      <Text selectable style={styles.body}>{result.text || t('devices.companions.noWrittenResult')}</Text>
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
