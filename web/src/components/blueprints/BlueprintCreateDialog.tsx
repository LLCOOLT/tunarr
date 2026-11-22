import { ContentPreview } from '@/components/auto-channel/ContentPreview';
import {
  GlobalContentControls,
  type GlobalContentContext,
} from '@/components/auto-channel/GlobalContentControls';
import { getApiErrorMessage } from '@/helpers/apiError.ts';
import {
  useBlueprintPreview,
  useCreateChannelFromBlueprint,
} from '@/hooks/useBlueprints';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate } from '@tanstack/react-router';
import type { Blueprint, BlueprintScope } from '@tunarr/types/api';
import { useMemo, useState } from 'react';

type Props = {
  blueprint: Blueprint | undefined;
  onClose: () => void;
};

function scopeFromContext(ctx: GlobalContentContext): BlueprintScope {
  const scope: BlueprintScope = {};
  if (ctx.mediaSourceId) {
    scope.mediaSourceIds = [ctx.mediaSourceId];
  }
  if (ctx.libraryIds?.length) {
    scope.libraryIds = ctx.libraryIds;
  }
  return scope;
}

/** Pick a scope, check what each role matches, then name and create. */
export function BlueprintCreateDialog({ blueprint, onClose }: Props) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [context, setContext] = useState<GlobalContentContext>({});
  const [channelName, setChannelName] = useState('');
  const [channelNumber, setChannelNumber] = useState('');
  const scope = useMemo(() => scopeFromContext(context), [context]);
  const preview = useBlueprintPreview(blueprint, scope);
  const create = useCreateChannelFromBlueprint();

  const number = channelNumber === '' ? undefined : Number(channelNumber);
  const numberInvalid =
    number !== undefined && (!Number.isInteger(number) || number < 1);
  const emptyRole = preview.data?.roles.find(
    (r) => r.preview.totalPrograms === 0,
  );

  const handleCreate = () => {
    if (!blueprint || numberInvalid) {
      return;
    }
    create.mutate(
      {
        blueprint,
        scope,
        channelName: channelName.trim() || undefined,
        channelNumber: number,
      },
      {
        onSuccess: (channel) => {
          onClose();
          navigate({
            to: '/channels/$channelId',
            params: { channelId: channel.id },
          }).catch(console.error);
        },
      },
    );
  };

  return (
    <Dialog
      open={blueprint !== undefined}
      onClose={onClose}
      fullWidth
      maxWidth="md"
    >
      <DialogTitle>
        {blueprint ? (
          <Trans>Create a channel from {blueprint.name}</Trans>
        ) : null}
      </DialogTitle>
      <DialogContent>
        {blueprint ? (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {blueprint.description}
            </Typography>
            <GlobalContentControls
              context={context}
              onContextChange={setContext}
            />
            {preview.error ? (
              <Alert severity="error">
                {getApiErrorMessage(preview.error) ??
                  t`The preview could not be loaded`}
              </Alert>
            ) : null}
            {blueprint.roles.map((role) => {
              const rolePreview = preview.data?.roles.find(
                (r) => r.role === role.role,
              );
              return (
                <Stack key={role.role} spacing={1}>
                  <Typography variant="subtitle1">{role.label}</Typography>
                  {role.query.filterString ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontFamily: 'monospace' }}
                    >
                      {role.query.filterString}
                    </Typography>
                  ) : null}
                  <ContentPreview
                    preview={rolePreview?.preview}
                    isLoading={preview.isFetching}
                    error={null}
                  />
                </Stack>
              );
            })}
            {emptyRole ? (
              <Alert severity="warning">
                <Trans>
                  “{emptyRole.label}” matches nothing in this scope, so the
                  channel cannot be created.
                </Trans>
              </Alert>
            ) : null}
            <Stack direction="row" spacing={2}>
              <TextField
                label={t`Channel name`}
                placeholder={(
                  blueprint.channel.namePattern ?? '{name} {number}'
                )
                  .replaceAll('{name}', blueprint.name)
                  .replaceAll('{number}', '#')}
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                size="small"
                fullWidth
              />
              <TextField
                label={t`Channel number`}
                placeholder={t`Next free`}
                value={channelNumber}
                onChange={(e) => setChannelNumber(e.target.value)}
                error={numberInvalid}
                helperText={
                  numberInvalid ? t`A whole number from 1` : undefined
                }
                size="small"
                inputMode="numeric"
                sx={{ width: 200 }}
              />
            </Stack>
            {create.error ? (
              <Alert severity="error">
                {getApiErrorMessage(create.error) ??
                  t`The channel could not be created`}
              </Alert>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={
            create.isPending ||
            numberInvalid ||
            emptyRole !== undefined ||
            !preview.data
          }
          startIcon={create.isPending ? <CircularProgress size={16} /> : null}
        >
          <Trans>Create Channel</Trans>
        </Button>
      </DialogActions>
    </Dialog>
  );
}
