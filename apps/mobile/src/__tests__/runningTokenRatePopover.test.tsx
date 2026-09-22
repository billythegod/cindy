// @vitest-environment jsdom
import {
  act,
  createElement,
  forwardRef,
  useImperativeHandle,
  useEffect,
  useState,
} from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearRateHistoryCache } from "@cindy/maker-shared/usage-format";
import { RunningTokenRatePopover } from "@/session/RunningTokenRatePopover";

const harness = vi.hoisted(() => ({
  viewport: { x: 0, y: 0, width: 320, height: 800 },
  window: { width: 320, height: 800 },
  anchor: { x: 220, y: 600, width: 80 },
  insets: { top: 24, bottom: 16, left: 0, right: 0 },
  press: {} as Record<string, (...args: any[]) => void>,
  backdrop: {} as Record<string, (...args: any[]) => void>,
  card: {} as Record<string, (...args: any[]) => void>,
}));
vi.mock("react-native", () => {
  const view = ({ children, testID }: any) =>
    createElement("div", { "data-testid": testID }, children);
  return {
    View: forwardRef((props: any, ref) => {
      useImperativeHandle(ref, () => ({
        measureInWindow: (callback: any) =>
          callback(
            harness.anchor.x,
            harness.anchor.y,
            harness.anchor.width,
            44,
          ),
      }));
      if (props.testID === "session.tokenRate.card") harness.card = props;
      return view(props);
    }),
    Modal: ({ visible, children }: any) =>
      visible ? createElement("div", {}, children) : null,
    useWindowDimensions: () => harness.window,
    ScrollView: view,
    Text: view,
    StyleSheet: { create: (s: unknown) => s },
    Pressable: (props: any) => {
      if (props.testID === "session.tokenRate.backdrop")
        harness.backdrop = props;
      else harness.press = props;
      return view(props);
    },
  };
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => harness.insets,
}));
vi.mock("@/components/AppText", async () => ({
  Text: (await import("react-native")).Text,
}));
vi.mock("react-native-svg", () => ({
  default: ({ children }: any) => createElement("div", {}, children),
  Path: () => null,
  Circle: () => null,
}));
vi.mock("@/platform/AdaptiveWindowContext", () => ({
  usePaneViewport: () => harness.viewport,
}));
vi.mock("@/theme", async () => {
  const { lightColors } = await import("@/theme/tokens");
  return {
    useTheme: () => ({ colors: lightColors }),
    useThemedStyles: (make: any) => make(lightColors),
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, args?: any) =>
      key.endsWith("tokenRate")
        ? `${args.rate} tok/s`
        : key.endsWith("tokenCount")
          ? `${args.tokens} tok`
          : key,
  }),
}));

let root: Root;
let host: HTMLDivElement;
const base = {
  sessionKey: "account/device/task",
  startedAt: 1,
  outputTokens: 0,
  generationDurationMs: 0,
  generationReliable: true,
  label: "0s",
  children: "trigger",
};
const render = async (props = {}) =>
  act(async () =>
    root.render(createElement(RunningTokenRatePopover, { ...base, ...props })),
  );
const gesture = async (name: string, x = 0, y = 0) =>
  act(async () => harness.press[name]({ nativeEvent: { pageX: x, pageY: y } }));
const card = () => host.querySelector('[data-testid="session.tokenRate.card"]');

// Exercise the actual status component without mounting the entire session route.
const route = ts.createSourceFile(
  "session.tsx",
  readFileSync(resolve(process.cwd(), "app/sessions/[sessionId].tsx"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const statusSource = route.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) &&
    node.name?.text === "ComposerActivityStatus",
)!;
const compiledStatus = ts.transpileModule(statusSource.getText(route), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText;
const bindings = {
  React: { createElement, Fragment: "div" },
  useEffect,
  useState,
  useThemedStyles: () => ({}),
  makeStyles: () => ({}),
  useTheme: () => ({ colors: {} }),
  useTranslation: () => ({ t: (key: string) => key }),
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  BlurBackdrop: () => null,
  Sparkles: () => null,
  ArrowDown: () => null,
  iconSize: {},
  iconStroke: {},
  RunningTokenRatePopover,
  formatComposerActivityElapsed: () => "1s",
  formatComposerActivityTokenCount: () => "100",
  formatComposerActivityRateValue: () => "50",
};
const ActivityStatus = new Function(
  ...Object.keys(bindings),
  `${compiledStatus}; return ComposerActivityStatus;`,
)(...Object.values(bindings));

it.each(["onPress", "onLongPress"])(
  "removes the %s rate panel through side tasks and every reconnect kind, then restores a closed trigger",
  async (open) => {
    const renderStatus = (status: Record<string, unknown> = {}) =>
      act(async () =>
        root.render(
          createElement(ActivityStatus, {
            ...base,
            visible: true,
            tokenUsage: 100,
            sideTaskRunning: false,
            reconnectAttempt: null,
            ...status,
          }),
        ),
      );
    for (const inactive of [
      { sideTaskRunning: true },
      ...[undefined, "overload", "rate-limit"].map((kind) => ({
        reconnectAttempt: { kind, attempt: 1, maxAttempts: 3 },
      })),
      { visible: false },
    ]) {
      await renderStatus();
      await gesture("onPressIn");
      await gesture(open);
      expect(card()).not.toBeNull();
      await renderStatus(inactive);
      expect(card()).toBeNull();
      expect(
        host.querySelector('[data-testid="session.tokenRate.trigger"]'),
      ).toBeNull();
      await renderStatus({
        ...inactive,
        outputTokens: 999,
        generationDurationMs: 9000,
      });
      expect(card()).toBeNull();
      await renderStatus();
      expect(card()).toBeNull();
      expect(
        host.querySelector('[data-testid="session.tokenRate.trigger"]'),
      ).not.toBeNull();
    }
  },
);
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearRateHistoryCache();
  harness.viewport = { x: 0, y: 0, width: 320, height: 800 };
  harness.window = { width: 320, height: 800 };
  harness.anchor = { x: 220, y: 600, width: 80 };
  harness.insets = { top: 24, bottom: 16, left: 0, right: 0 };
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

it("toggles on tap, holds only until release, and does not turn the long-press release into a tap", async () => {
  await render();
  expect(card()).toBeNull();
  await gesture("onPressIn");
  await gesture("onPress");
  expect(card()).not.toBeNull();
  await gesture("onPressIn");
  await gesture("onPress");
  expect(card()).toBeNull();
  await gesture("onPressIn");
  await gesture("onLongPress");
  expect(card()).not.toBeNull();
  await gesture("onPressOut");
  await gesture("onPress");
  expect(card()).toBeNull();
  await gesture("onPressIn");
  await gesture("onPress");
  expect(card()).not.toBeNull();
});

it("dismisses on outside tap, but not card taps or swipes", async () => {
  await render();
  await gesture("onPress");
  expect(harness.card.onStartShouldSetResponder()).toBe(true);
  expect(card()).not.toBeNull();
  await act(async () => {
    harness.backdrop.onPressIn({ nativeEvent: { pageX: 20, pageY: 20 } });
    harness.backdrop.onTouchMove({ nativeEvent: { pageX: 20, pageY: 80 } });
    harness.backdrop.onPress();
  });
  expect(card()).not.toBeNull();
  await act(async () => {
    harness.backdrop.onPressIn({ nativeEvent: { pageX: 20, pageY: 20 } });
    harness.backdrop.onPress();
  });
  expect(card()).toBeNull();
  await gesture("onPressIn");
  await gesture("onLongPress");
  expect(
    host.querySelector('[data-testid="session.tokenRate.backdrop"]'),
  ).toBeNull();
  await gesture("onTouchCancel");
  expect(card()).toBeNull();
});

it.each(["x", "y", "width", "height"] as const)(
  "dismisses when pane %s changes inside the same window",
  async (dimension) => {
    harness.viewport = { x: 0, y: 0, width: 240, height: 600 };
    await render();
    await gesture("onPress");
    expect(card()).not.toBeNull();
    await render({ outputTokens: 10 });
    expect(card()).not.toBeNull();
    harness.viewport = {
      ...harness.viewport,
      [dimension]: harness.viewport[dimension] + 40,
    };
    await render({ outputTokens: 10 });
    expect(card()).toBeNull();
    await gesture("onPressIn");
    await gesture("onPress");
    expect(card()).not.toBeNull();
  },
);

it.each(["onPress", "onLongPress"])(
  "keeps %s cards inside safe bounds as anchor and text height vary",
  async (open) => {
    harness.window = { width: 800, height: 360 };
    harness.viewport = { x: 0, y: 0, ...harness.window };
    harness.insets = { top: 24, bottom: 16, left: 44, right: 44 };
    for (const y of [30, 180, 340]) {
      harness.anchor = { x: 780, y, width: 20 };
      await render({ key: String(y) });
      await gesture("onPressIn");
      await gesture(open);
      for (const height of [100, 220, 296]) {
        await act(async () =>
          harness.card.onLayout({ nativeEvent: { layout: { height } } }),
        );
        const style = Object.assign({}, ...(harness.card as any).style);
        const x = style.left + (open === "onLongPress" ? harness.anchor.x : 0);
        const top = style.top + (open === "onLongPress" ? y : 0);
        expect(x).toBeGreaterThanOrEqual(harness.insets.left);
        expect(x + style.width).toBeLessThanOrEqual(800 - harness.insets.right);
        expect(top).toBeGreaterThanOrEqual(harness.insets.top);
        expect(top + height).toBeLessThanOrEqual(360 - harness.insets.bottom);
        expect(style.maxHeight).toBeLessThanOrEqual(
          360 - harness.insets.top - harness.insets.bottom,
        );
      }
    }
  },
);

it("uses paired generation samples, expires recent speed, and isolates a different task", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  await render();
  await render({ outputTokens: 100, generationDurationMs: 1000 });
  await render({ outputTokens: 150, generationDurationMs: 2000 });
  await gesture("onPress");
  expect(card()!.textContent).toContain("50");
  expect(card()!.textContent).toContain("75 tok/s");
  expect(card()!.textContent).toContain("100 tok/s");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(card()!.textContent).toContain("—");
  await render({ key: "other", sessionKey: "account/device/other" });
  expect(card()).toBeNull();
  await gesture("onPressIn");
  await gesture("onPress");
  expect(card()!.textContent).not.toContain("100 tok/s");
});
