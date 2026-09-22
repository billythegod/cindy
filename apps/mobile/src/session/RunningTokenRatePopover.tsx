import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Text } from "@/components/AppText";
import Svg, { Circle, Path } from "react-native-svg";
import { useTranslation } from "react-i18next";
import {
  emptyRateHistory,
  loadCachedRateHistory,
  recordRunningTokenRate,
  saveCachedRateHistory,
  RATE_SAMPLE_FRESH_MS,
} from "@cindy/maker-shared/usage-format";
import { useTheme, useThemedStyles, type ThemeColors } from "@/theme";
import {
  fontWeight,
  iconStroke,
  lineHeight,
  radius,
  spacing,
  typeScale,
} from "@/theme/tokens";
import { usePaneViewport } from "@/platform/AdaptiveWindowContext";

export function formatTokenRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate) || rate < 0) return "—";
  if (rate === 0) return "0";
  return rate < 0.1
    ? "<0.1"
    : rate >= 100
      ? rate.toFixed(0)
      : rate.toFixed(1).replace(/\.0$/, "");
}

/** Key this component by account/device/session so gestures and counters never cross tasks. */
export function RunningTokenRatePopover({
  sessionKey,
  startedAt,
  outputTokens,
  generationDurationMs,
  generationReliable,
  children,
  label,
}: {
  sessionKey: string;
  startedAt: number | null;
  outputTokens: number;
  generationDurationMs: number;
  generationReliable: boolean;
  children: ReactNode;
  label: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation();
  const viewport = usePaneViewport();
  const window = useWindowDimensions();
  const anchorRef = useRef<View>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0, width: 0 });
  const outsideTouch = useRef({ x: 0, y: 0, moved: false });
  const cardWidth = Math.min(304, viewport.width - spacing.xl * 2);
  const [mode, setMode] = useState<"closed" | "pinned" | "held">("closed");
  // A pane can move or resize without changing the native window dimensions.
  useEffect(() => setMode("closed"), [
    window.width,
    window.height,
    viewport.x,
    viewport.y,
    viewport.width,
    viewport.height,
  ]);
  const longPressed = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [history, setHistory] = useState(() => {
    const cached = loadCachedRateHistory(sessionKey);
    return cached
      ? { ...cached, baseline: null, lastReport: null, latestRate: null }
      : emptyRateHistory(null);
  });
  useEffect(() => {
    setHistory((previous) =>
      recordRunningTokenRate(previous, {
        startedAt,
        outputTokens,
        generationDurationMs,
        generationReliable,
      }),
    );
  }, [startedAt, outputTokens, generationDurationMs, generationReliable]);
  useEffect(() => {
    saveCachedRateHistory(sessionKey, history);
  }, [sessionKey, history]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (history.latestSampleAt === undefined) return;
    setNow(Date.now());
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, history.latestSampleAt + RATE_SAMPLE_FRESH_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [history.latestSampleAt]);
  const recent =
    generationReliable &&
    (startedAt === null || startedAt === history.startedAt) &&
    history.latestSampleAt !== undefined &&
    Math.max(now, Date.now()) - history.latestSampleAt < RATE_SAMPLE_FRESH_MS
      ? history.latestRate
      : null;
  const average =
    generationReliable && generationDurationMs > 0 && outputTokens > 0
      ? (outputTokens * 1000) / generationDurationMs
      : null;
  const samples = history.samples;
  const firstTime = samples[0]?.durationMs ?? 0;
  const span = (samples.at(-1)?.durationMs ?? 0) - firstTime;
  const ceiling = Math.max(1, ...samples.map((sample) => sample.rate));
  const points = samples.map((sample) => ({
    x: span > 0 ? 4 + ((sample.durationMs - firstTime) / span) * 108 : 112,
    y: 44 - (sample.rate / ceiling) * 36,
  }));
  const line = points
    .map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`)
    .join(" ");
  const last = points.at(-1);
  const rateText = (rate: number | null) =>
    rate === null
      ? "—"
      : t("session.screen.tokenRate", { rate: formatTokenRate(rate) });
  const card = (
    <View
      pointerEvents={mode === "held" ? "none" : "auto"}
      onStartShouldSetResponder={() => true}
      onAccessibilityEscape={() => setMode("closed")}
      testID="session.tokenRate.card"
      style={[
        styles.card,
        { width: cardWidth },
        mode === "pinned"
          ? {
              right: undefined,
              left: Math.max(
                spacing.lg,
                Math.min(
                  anchor.x + anchor.width - cardWidth,
                  window.width - cardWidth - spacing.lg,
                ),
              ),
              bottom: Math.max(spacing.lg, window.height - anchor.y),
            }
          : undefined,
      ]}
      accessibilityLabel={t("session.screen.tokenRateDescription")}
    >
      <View style={styles.top}>
        <View style={styles.metric}>
          <Text style={styles.label}>{t("session.screen.currentRate")}</Text>
          <Text style={styles.value}>
            {formatTokenRate(recent)}{" "}
            <Text style={styles.label}>
              {t("session.screen.tokenRateUnit")}
            </Text>
          </Text>
        </View>
        <Svg
          width={120}
          height={48}
          viewBox="0 0 120 48"
          accessibilityLabel={t("session.screen.rateHistory")}
        >
          <Path d="M4 44H112" stroke={colors.textPrimary} opacity={0.12} />
          {points.length > 1 && (
            <>
              <Path
                d={`${line} L112,44 L${points[0].x},44 Z`}
                fill={colors.textPrimary}
                opacity={0.08}
              />
              <Path
                d={line}
                fill="none"
                stroke={colors.textPrimary}
                strokeWidth={iconStroke.thin}
                strokeLinejoin="round"
              />
            </>
          )}
          {last && (
            <Circle cx={last.x} cy={last.y} r={2.5} fill={colors.textPrimary} />
          )}
        </Svg>
      </View>
      <View style={styles.top}>
        {[
          ["averageRate", rateText(average)],
          [
            "outputTotal",
            t("session.screen.tokenCount", {
              tokens:
                outputTokens >= 1000
                  ? `${(outputTokens / 1000).toFixed(1)}k`
                  : outputTokens,
            }),
          ],
          ["observedPeak", rateText(samples.length ? history.peak : null)],
        ].map(([key, value]) => (
          <View style={styles.metric} key={key}>
            <Text style={styles.label}>{t(`session.screen.${key}`)}</Text>
            <Text style={styles.detail}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: mode !== "closed" }}
        testID="session.tokenRate.trigger"
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
        onPressIn={(event) => {
          longPressed.current = false;
          touchStart.current = {
            x: event.nativeEvent.pageX,
            y: event.nativeEvent.pageY,
          };
        }}
        onLongPress={() => {
          longPressed.current = true;
          setMode("held");
        }}
        onPress={() => {
          if (longPressed.current) return;
          if (mode === "pinned") {
            setMode("closed");
            return;
          }
          anchorRef.current?.measureInWindow((x, y, width) => {
            setAnchor({ x, y, width });
            setMode("pinned");
          });
        }}
        onPressOut={() =>
          setMode((value) => (value === "held" ? "closed" : value))
        }
        onTouchCancel={() =>
          setMode((value) => (value === "held" ? "closed" : value))
        }
        onTouchMove={(event) => {
          const start = touchStart.current;
          if (
            start &&
            Math.hypot(
              event.nativeEvent.pageX - start.x,
              event.nativeEvent.pageY - start.y,
            ) > 8
          ) {
            longPressed.current = true;
          }
        }}
      >
        {children}
      </Pressable>
      {mode === "held" && card}
      <Modal
        visible={mode === "pinned"}
        transparent
        animationType="none"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setMode("closed")}
      >
        <View style={styles.overlay}>
          <Pressable
            testID="session.tokenRate.backdrop"
            style={StyleSheet.absoluteFill}
            accessible={false}
            onPressIn={(event) => {
              outsideTouch.current = {
                x: event.nativeEvent.pageX,
                y: event.nativeEvent.pageY,
                moved: false,
              };
            }}
            onTouchMove={(event) => {
              const start = outsideTouch.current;
              if (
                Math.hypot(
                  event.nativeEvent.pageX - start.x,
                  event.nativeEvent.pageY - start.y,
                ) > 8
              )
                start.moved = true;
            }}
            onPress={() => {
              if (!outsideTouch.current.moved) setMode("closed");
            }}
          />
          {card}
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: { flex: 1 },
    anchor: { position: "relative", flexShrink: 0 },
    trigger: {
      minHeight: 44,
      minWidth: 44,
      justifyContent: "center",
      borderRadius: radius.pill,
    },
    pressed: { opacity: 0.72 },
    card: {
      position: "absolute",
      right: 0,
      bottom: "100%",
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.container,
      padding: spacing.md,
      gap: spacing.md,
    },
    top: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    metric: { flex: 1, gap: spacing.xs },
    label: {
      color: colors.textSecondary,
      fontSize: typeScale.caption,
      lineHeight: lineHeight.caption,
    },
    value: {
      color: colors.textPrimary,
      fontSize: typeScale.headline,
      fontWeight: fontWeight.medium,
      fontVariant: ["tabular-nums"],
    },
    detail: {
      color: colors.textPrimary,
      fontSize: typeScale.caption,
      fontWeight: fontWeight.medium,
      fontVariant: ["tabular-nums"],
    },
  });
