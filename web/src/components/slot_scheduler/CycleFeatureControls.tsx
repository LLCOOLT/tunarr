import { Trans, useLingui } from '@lingui/react/macro';
import {
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { TimePicker } from '@mui/x-date-pickers';
import {
  DefaultPremiereTimeOfDayMs,
  RerunWeightingModeSchema,
  type PremiereConfig,
  type RerunWeighting,
  type RerunWeightingMode,
} from '@tunarr/types/api';
import dayjs from 'dayjs';

const defaultPremieres: PremiereConfig = {
  enabled: false,
  timeOfDayMs: DefaultPremiereTimeOfDayMs,
  maxPerDay: 1,
};

const defaultWeighting: RerunWeighting = { mode: 'off', strength: 0.5 };

type PremieresProps = {
  value: PremiereConfig | undefined;
  onChange: (value: PremiereConfig) => void;
  // Premieres are placed in later cycles, so they need Rebuild each cycle.
  rebuildEachCycle: boolean;
};

/**
 * The premieres setting of a slot schedule
 * (plans/premieres-and-rerun-weighting.md).
 */
export function PremieresControl({
  value,
  onChange,
  rebuildEachCycle,
}: PremieresProps) {
  const { t } = useLingui();
  const config = value ?? defaultPremieres;
  const enabled = config.enabled && rebuildEachCycle;

  return (
    <FormGroup>
      <FormControlLabel
        control={
          <Switch
            checked={enabled}
            disabled={!rebuildEachCycle}
            onChange={(_, checked) => onChange({ ...config, enabled: checked })}
          />
        }
        label={<Trans>Premiere new episodes</Trans>}
      />
      <FormHelperText>
        {rebuildEachCycle ? (
          <Trans>
            When a library scan adds a new episode of a show this schedule
            plays, it airs at the time below on the next day, in the first slot
            that plays that show. It then joins the normal rotation. The guide
            marks the airing as a premiere.
          </Trans>
        ) : (
          <Trans>Turn on Rebuild each cycle to use premieres.</Trans>
        )}
      </FormHelperText>
      {enabled && (
        <Stack direction="row" gap={2} sx={{ mt: 2 }}>
          <TimePicker
            reduceAnimations
            label={t`Premiere time`}
            value={dayjs().startOf('day').add(config.timeOfDayMs)}
            onChange={(time) => {
              if (!time || !time.isValid()) {
                return;
              }
              onChange({
                ...config,
                timeOfDayMs: time.diff(time.startOf('day')),
              });
            }}
          />
          <TextField
            type="number"
            label={t`Premieres per slot per day`}
            value={config.maxPerDay}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(parsed) && parsed > 0) {
                onChange({ ...config, maxPerDay: parsed });
              }
            }}
          />
        </Stack>
      )}
    </FormGroup>
  );
}

type RerunWeightingProps = {
  value: RerunWeighting | undefined;
  onChange: (value: RerunWeighting) => void;
};

/**
 * The rerun weighting setting of a slot schedule
 * (plans/premieres-and-rerun-weighting.md).
 */
export function RerunWeightingControl({
  value,
  onChange,
}: RerunWeightingProps) {
  const { t } = useLingui();
  const config = value ?? defaultWeighting;

  return (
    <FormGroup>
      <FormControl sx={{ maxWidth: 360 }}>
        <InputLabel id="rerun-weighting-mode">
          <Trans>Rerun weighting</Trans>
        </InputLabel>
        <Select<RerunWeightingMode>
          labelId="rerun-weighting-mode"
          label={t`Rerun weighting`}
          value={config.mode}
          onChange={(e) => {
            const mode = RerunWeightingModeSchema.safeParse(e.target.value);
            if (mode.success) {
              onChange({ ...config, mode: mode.data });
            }
          }}
        >
          <MenuItem value="off">
            <Trans>Off</Trans>
          </MenuItem>
          <MenuItem value="least_recent">
            <Trans>Favor what aired longest ago</Trans>
          </MenuItem>
          <MenuItem value="unwatched">
            <Trans>Favor what aired longest ago and unwatched</Trans>
          </MenuItem>
        </Select>
      </FormControl>
      <FormHelperText>
        <Trans>
          Shuffled slots still play every program once before repeating, but
          order each pass so that programs that aired recently on this channel
          come later. The unwatched option also moves programs your Plex account
          has already watched later. Tunarr only reads watch state; it never
          changes it.
        </Trans>
      </FormHelperText>
      {config.mode !== 'off' && (
        <Stack sx={{ mt: 2, maxWidth: 360 }}>
          <Typography variant="body2" id="rerun-weighting-strength">
            <Trans>Strength</Trans>
          </Typography>
          <Slider
            aria-labelledby="rerun-weighting-strength"
            min={0}
            max={1}
            step={0.05}
            value={config.strength}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
            onChange={(_, strength) => {
              if (typeof strength === 'number') {
                onChange({ ...config, strength });
              }
            }}
          />
        </Stack>
      )}
    </FormGroup>
  );
}
