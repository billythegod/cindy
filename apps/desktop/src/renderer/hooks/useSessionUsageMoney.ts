/**
 * 会话金额的统一展示投影。
 *
 * actual-cost 由 sessions 账本持有，value-estimate 由消息明细重建。二者是不同
 * 的事实源，但“本对话”展示需要稳定地汇总两者，不能由当前模型/provider 决定
 * 只读取其中一条链路。
 */

import { useMemo } from 'react';

import { addCompatibleRegionalMoney, type RegionalMoney } from '../../shared/regionalMoney';
import { useSessionEstimatedValue } from './useSessionEstimatedValue';
import { useSessionSpend } from './useSessionSpend';

export interface SessionUsageMoney {
  actualMoney: RegionalMoney | null;
  estimatedValueMoney: RegionalMoney | null;
  totalMoney: RegionalMoney | null;
}

export function combineSessionUsageMoney(
  actualMoney: RegionalMoney | null,
  estimatedValueMoney: RegionalMoney | null,
): SessionUsageMoney {
  // 零费用只是占位，不能用它的区域币种过滤实际存在的订阅估值。
  // 异币种保留各自金额供 UI 分别展示，不换算、不伪造合计。
  const values = [actualMoney, estimatedValueMoney].filter((money): money is RegionalMoney =>
    Boolean(money && money.amount > 0),
  );
  const currency = values[0]?.currency;
  return {
    actualMoney,
    estimatedValueMoney,
    totalMoney:
      currency && values.every((money) => money.currency === currency)
        ? addCompatibleRegionalMoney(values, currency)
        : null,
  };
}

export function useSessionUsageMoney(
  sessionId: string | undefined,
  initialMoney: RegionalMoney | null | undefined,
  initialCostUsd: number | null | undefined,
): SessionUsageMoney {
  const actualMoney = useSessionSpend(sessionId, initialMoney, initialCostUsd);
  const estimatedValueMoney = useSessionEstimatedValue(sessionId, Boolean(sessionId));

  return useMemo(
    () => combineSessionUsageMoney(actualMoney, estimatedValueMoney),
    [actualMoney, estimatedValueMoney],
  );
}
