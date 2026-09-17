import { useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, Modal, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/AppText';
import { MainWindowActionButton } from '@/components/MobilePrimitives';
import {
  fontWeight,
  radius,
  spacing,
  typeScale,
  useTheme,
  useThemedStyles,
  type ThemeColors,
} from '@/theme';
import { androidApkUpdater as updater } from './androidApkUpdateService';

/** Root-owned so a forced-update gate or a settings navigation cannot lose the download. */
export function AndroidApkUpdateOverlay() {
  const state = useSyncExternalStore(updater.subscribe, updater.getSnapshot, updater.getSnapshot);
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void updater.resume();
    });
    return () => subscription.remove();
  }, []);
  if (Platform.OS !== 'android') return null;
  const downloading = state.phase === 'downloading';
  const installing = state.phase === 'installing';
  const percent =
    state.total > 0 ? Math.min(100, Math.floor((state.received / state.total) * 100)) : null;
  const close = () => {
    if (downloading) void updater.cancel();
    else updater.dismiss();
  };
  const body = downloading
    ? t('update.apkDownloading')
    : installing
      ? t('update.apkOpeningInstaller')
      : state.phase === 'permission'
        ? t('update.apkPermissionBody')
        : state.phase === 'error'
          ? t(`update.apkError.${state.error ?? 'download'}`)
          : t('update.apkReady');
  return (
    <Modal transparent animationType="fade" visible={state.visible} onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <Text style={styles.title}>{t('update.goUpdate')}</Text>
          <Text style={styles.body} accessibilityLiveRegion="polite">
            {body}
          </Text>
          {downloading ? (
            <View
              accessibilityRole="progressbar"
              accessibilityValue={percent === null ? undefined : { min: 0, max: 100, now: percent }}
            >
              {percent === null ? (
                <ActivityIndicator color={colors.textSecondary} />
              ) : (
                <Text style={styles.body}>{t('update.apkProgress', { percent })}</Text>
              )}
              <Text style={styles.body}>
                {t('update.apkDownloaded', {
                  size: (state.received / 1048576).toFixed(1),
                })}
              </Text>
            </View>
          ) : null}
          {state.phase === 'permission' ? (
            <MainWindowActionButton
              action={{
                label: t('update.apkAllowInstall'),
                tone: 'primary',
                onPress: () => void updater.openPermissionSettings(),
              }}
            />
          ) : null}
          {state.phase === 'ready' ? (
            <MainWindowActionButton
              action={{
                label: t('update.apkInstall'),
                tone: 'primary',
                onPress: () => void updater.install(),
              }}
            />
          ) : null}
          {state.phase === 'error' && state.error !== 'unavailable' ? (
            <MainWindowActionButton
              action={{
                label: t('update.apkRetry'),
                tone: 'primary',
                onPress: () => void updater.retry(),
              }}
            />
          ) : null}
          <MainWindowActionButton
            action={{
              label: downloading ? t('update.apkCancel') : t('shared.closePanel'),
              disabled: installing,
              onPress: close,
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'center',
      padding: spacing.xl,
      backgroundColor: colors.overlay,
    },
    dialog: {
      width: '100%',
      maxWidth: 420,
      alignSelf: 'center',
      padding: spacing.lg,
      gap: spacing.md,
      borderRadius: radius.container,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    title: {
      fontSize: typeScale.title,
      fontWeight: fontWeight.medium,
      color: colors.textPrimary,
    },
    body: { fontSize: typeScale.body, color: colors.textSecondary },
  });
