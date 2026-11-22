import { Trans } from '@lingui/react/macro';
import {
  FormControlLabel,
  FormGroup,
  FormHelperText,
  Switch,
} from '@mui/material';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  scheduleType: 'time' | 'random';
};

/**
 * The "Rebuild each cycle" switch of a slot schedule
 * (plans/schedules-reshuffle-on-loop.md, Opt-in).
 */
export function RebuildEachCycleControl({
  checked,
  onChange,
  scheduleType,
}: Props) {
  return (
    <FormGroup>
      <FormControlLabel
        control={
          <Switch checked={checked} onChange={(_, value) => onChange(value)} />
        }
        label={<Trans>Rebuild each cycle</Trans>}
      />
      <FormHelperText>
        {scheduleType === 'time' ? (
          <Trans>
            Builds a new cycle from this schedule before the current one ends,
            instead of looping the same programs. Shuffled slots get a new order
            every cycle and ordered shows continue where they left off. A cycle
            is one schedule period, so Days to Precalculate is not used.
          </Trans>
        ) : (
          <Trans>
            Builds a new cycle from this schedule before the current one ends,
            instead of looping the same programs. Shuffled slots get a new order
            every cycle and ordered shows continue where they left off.
          </Trans>
        )}
      </FormHelperText>
    </FormGroup>
  );
}
