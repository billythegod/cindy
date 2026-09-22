// @vitest-environment jsdom
import { act, createElement, forwardRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearRateHistoryCache } from "@cindy/maker-shared/usage-format";
import { RunningTokenRatePopover } from "@/session/RunningTokenRatePopover";

const harness = vi.hoisted(() => ({
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
        measureInWindow: (callback: any) => callback(220, 600, 80, 44),
      }));
      if (props.testID === "session.tokenRate.card") harness.card = props;
      return view(props);
    }),
    Modal: ({ visible, children }: any) =>
      visible ? createElement("div", {}, children) : null,
    useWindowDimensions: () => ({ width: 320, height: 800 }),
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
vi.mock("@/components/AppText", async () => ({
  Text: (await import("react-native")).Text,
}));
vi.mock("react-native-svg", () => ({
  default: ({ children }: any) => createElement("div", {}, children),
  Path: () => null,
  Circle: () => null,
}));
vi.mock("@/platform/AdaptiveWindowContext", () => ({
  usePaneViewport: () => ({ width: 320 }),
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
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearRateHistoryCache();
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
