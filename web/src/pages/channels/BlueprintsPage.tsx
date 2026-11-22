import { BlueprintCard } from '@/components/blueprints/BlueprintCard';
import { BlueprintCreateDialog } from '@/components/blueprints/BlueprintCreateDialog';
import {
  downloadBlueprint,
  readBlueprintFile,
} from '@/components/blueprints/blueprintFile';
import { RouterButtonLink } from '@/components/base/RouterButtonLink';
import { PageHeader } from '@/components/ui/PageHeader';
import { getApiErrorMessage } from '@/helpers/apiError.ts';
import {
  useBlueprints,
  useDeleteBlueprint,
  useImportBlueprint,
} from '@/hooks/useBlueprints';
import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowBack, UploadFile } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import type { Blueprint } from '@tunarr/types/api';
import { useSnackbar } from 'notistack';
import type { ChangeEvent } from 'react';
import { useRef, useState } from 'react';

/** The blueprint gallery: pick one, import one, export or delete one. */
export function BlueprintsPage() {
  const { t } = useLingui();
  const snackbar = useSnackbar();
  const blueprints = useBlueprints();
  const importMutation = useImportBlueprint();
  const deleteMutation = useDeleteBlueprint();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Blueprint | undefined>();
  const [importError, setImportError] = useState<string | undefined>();

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) {
      return;
    }
    const result = readBlueprintFile(await file.text());
    if (!result.success) {
      setImportError(result.message);
      return;
    }
    setImportError(undefined);
    importMutation.mutate(result.blueprint, {
      onSuccess: (saved) => {
        snackbar.enqueueSnackbar({
          variant: 'success',
          message: t`Imported “${saved.blueprint.name}”`,
        });
      },
      onError: (err) => {
        setImportError(
          getApiErrorMessage(err) ?? t`The blueprint could not be imported`,
        );
      },
    });
  };

  const saved = blueprints.data ?? [];
  const builtIns = saved.filter((b) => b.builtIn);
  const mine = saved.filter((b) => !b.builtIn);

  const renderGrid = (items: typeof saved) => (
    <Grid container spacing={2}>
      {items.map((item) => (
        <Grid key={item.id} size={{ xs: 12, sm: 6, md: 4 }}>
          <BlueprintCard
            saved={item}
            onUse={() => setSelected(item.blueprint)}
            onExport={() => downloadBlueprint(item.blueprint)}
            onDelete={
              item.builtIn ? undefined : () => deleteMutation.mutate(item.id)
            }
          />
        </Grid>
      ))}
    </Grid>
  );

  return (
    <Box>
      <PageHeader
        title={<Trans>Channel Blueprints</Trans>}
        subtitle={
          <Trans>
            Ready-made channel recipes. A blueprint names rules, not programs,
            so it fits any library. Pick one, check what it matches, and create
            the channel.
          </Trans>
        }
        actions={
          <Stack direction="row" spacing={1}>
            <RouterButtonLink
              to="/channels"
              variant="outlined"
              startIcon={<ArrowBack />}
            >
              <Trans>Channels</Trans>
            </RouterButtonLink>
            <Button
              variant="contained"
              startIcon={<UploadFile />}
              onClick={() => fileInput.current?.click()}
              disabled={importMutation.isPending}
            >
              <Trans>Import Blueprint</Trans>
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label={t`Blueprint file`}
              onChange={(e) => {
                handleFile(e).catch(console.error);
              }}
            />
          </Stack>
        }
      />

      {importError ? (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => setImportError(undefined)}
        >
          {importError}
        </Alert>
      ) : null}

      {blueprints.isLoading ? <CircularProgress /> : null}
      {blueprints.error ? (
        <Alert severity="error">
          {getApiErrorMessage(blueprints.error) ??
            t`The blueprints could not be loaded`}
        </Alert>
      ) : null}

      {mine.length > 0 ? (
        <Stack spacing={1} sx={{ mb: 4 }}>
          <Typography variant="h6">
            <Trans>Your blueprints</Trans>
          </Typography>
          {renderGrid(mine)}
        </Stack>
      ) : null}

      {builtIns.length > 0 ? (
        <Stack spacing={1}>
          <Typography variant="h6">
            <Trans>Built-in</Trans>
          </Typography>
          {renderGrid(builtIns)}
        </Stack>
      ) : null}

      <BlueprintCreateDialog
        blueprint={selected}
        onClose={() => setSelected(undefined)}
      />
    </Box>
  );
}
