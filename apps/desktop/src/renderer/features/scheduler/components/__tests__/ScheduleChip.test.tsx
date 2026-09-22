// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { ScheduleChip } from '../ScheduleChips';

afterEach(cleanup);

function renderChip(cronExpr: string, intervalMs?: number) {
  const onChange = vi.fn();
  function Harness() {
    const [schedule, setSchedule] = useState({ cronExpr, intervalMs });
    return <ScheduleChip {...schedule} onChangeSchedule={(next) => {
      onChange(next);
      setSchedule({ cronExpr: next.cronExpr, intervalMs: next.intervalMs });
    }} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button'));
  return onChange;
}

it.each([7, 28, 59])('keeps legacy */%i when the selected minute menu is clicked again', (minutes) => {
  const onChange = renderChip(`*/${minutes} * * * *`);
  const menu = screen.getByRole('button', { name: 'scheduler.chips.scheduleMenu.intervalMinutes' });
  fireEvent.click(menu);
  fireEvent.click(menu);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox').textContent).toContain(`${minutes}*`);
});

it.each([28, 59])('still lets an exact %i-minute interval explicitly enter the supported minute preset', (minutes) => {
  const onChange = renderChip(`*/${minutes} * * * *`, minutes * 60_000);
  fireEvent.click(screen.getByRole('button', { name: 'scheduler.chips.scheduleMenu.intervalMinutes' }));
  expect(onChange).toHaveBeenCalledWith({ cronExpr: '*/5 * * * *', intervalMs: 300_000 });
  onChange.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'scheduler.chips.scheduleMenu.intervalMinutes' }));
  expect(onChange).not.toHaveBeenCalled();
});

it.each([7, 28, 59])('switches a stale Cron from the current %i-minute interval and keeps the legacy value on menu re-selection', (minutes) => {
  const onChange = renderChip('*/5 * * * *', minutes * 60_000);
  fireEvent.click(screen.getByRole('button', { name: 'scheduler.chips.timingMode.cron' }));
  expect(onChange).toHaveBeenCalledWith({ cronExpr: `*/${minutes} * * * *`, intervalMs: undefined });
  expect(screen.getByRole('combobox').textContent).toContain(`${minutes}*`);
  onChange.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'scheduler.chips.scheduleMenu.intervalMinutes' }));
  expect(onChange).not.toHaveBeenCalled();
});
