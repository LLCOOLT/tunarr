import { categoryIcons } from '@/components/auto-channel/categoryIcons';
import { Trans, useLingui } from '@lingui/react/macro';
import { Delete, Download } from '@mui/icons-material';
import {
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import type { SavedBlueprint } from '@tunarr/types/api';

type Props = {
  saved: SavedBlueprint;
  onUse: () => void;
  onExport: () => void;
  onDelete?: () => void;
};

export function BlueprintCard({ saved, onUse, onExport, onDelete }: Props) {
  const { t } = useLingui();
  const { blueprint } = saved;
  return (
    <Card
      variant="outlined"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <CardActionArea
        onClick={onUse}
        sx={{ flexGrow: 1, alignItems: 'flex-start', display: 'flex' }}
        aria-label={t`Use the ${blueprint.name} blueprint`}
      >
        <CardContent sx={{ width: '100%' }}>
          <Stack direction="row" spacing={1} alignItems="center">
            {categoryIcons[blueprint.category]}
            <Typography variant="h6">{blueprint.name}</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {blueprint.description}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap">
            <Chip
              size="small"
              label={
                blueprint.schedule.type === 'time'
                  ? t`Time slots`
                  : t`Random slots`
              }
            />
            {saved.builtIn ? (
              <Chip size="small" variant="outlined" label={t`Built-in`} />
            ) : null}
          </Stack>
        </CardContent>
      </CardActionArea>
      <CardActions sx={{ justifyContent: 'flex-end' }}>
        <Tooltip title={<Trans>Export as a file</Trans>}>
          <IconButton
            aria-label={t`Export ${blueprint.name}`}
            onClick={onExport}
          >
            <Download />
          </IconButton>
        </Tooltip>
        {onDelete ? (
          <Tooltip title={<Trans>Delete</Trans>}>
            <IconButton
              aria-label={t`Delete ${blueprint.name}`}
              onClick={onDelete}
            >
              <Delete />
            </IconButton>
          </Tooltip>
        ) : null}
      </CardActions>
    </Card>
  );
}
