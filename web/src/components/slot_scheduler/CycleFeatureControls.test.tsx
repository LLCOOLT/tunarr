import { renderWithProviders, screen } from '@/test/utils';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { describe, expect, test, vi } from 'vitest';
import {
  PremieresControl,
  RerunWeightingControl,
} from './CycleFeatureControls.tsx';

describe('PremieresControl', () => {
  test('is disabled until Rebuild each cycle is on', () => {
    renderWithProviders(
      <PremieresControl
        value={undefined}
        onChange={vi.fn()}
        rebuildEachCycle={false}
      />,
    );

    expect(
      screen.getByRole('checkbox', { name: 'Premiere new episodes' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Turn on Rebuild each cycle to use premieres.'),
    ).toBeInTheDocument();
  });

  test('turning it on keeps the default time and cap', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <PremieresControl
        value={undefined}
        onChange={onChange}
        rebuildEachCycle
      />,
    );

    await user.click(
      screen.getByRole('checkbox', { name: 'Premiere new episodes' }),
    );

    expect(onChange).toHaveBeenCalledWith({
      enabled: true,
      timeOfDayMs: 20 * 60 * 60 * 1000,
      maxPerDay: 1,
    });
  });

  test('shows the time and cap fields once on', () => {
    renderWithProviders(
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <PremieresControl
          value={{ enabled: true, timeOfDayMs: 0, maxPerDay: 2 }}
          onChange={vi.fn()}
          rebuildEachCycle
        />
      </LocalizationProvider>,
    );

    expect(screen.getByLabelText('Premieres per slot per day')).toHaveValue(2);
  });
});

describe('RerunWeightingControl', () => {
  test('off hides the strength slider', () => {
    renderWithProviders(
      <RerunWeightingControl value={undefined} onChange={vi.fn()} />,
    );

    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  test('choosing a mode keeps the strength', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <RerunWeightingControl
        value={{ mode: 'off', strength: 0.3 }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(
      screen.getByRole('option', { name: 'Favor what aired longest ago' }),
    );

    expect(onChange).toHaveBeenCalledWith({
      mode: 'least_recent',
      strength: 0.3,
    });
  });

  test('a weighted mode shows the strength slider', () => {
    renderWithProviders(
      <RerunWeightingControl
        value={{ mode: 'unwatched', strength: 0.5 }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('slider')).toHaveValue('0.5');
  });
});
