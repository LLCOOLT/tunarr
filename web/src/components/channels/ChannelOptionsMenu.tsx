import type { channelListOptions } from '@/types/index.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Architecture,
  ContentCopy,
  CopyAll,
  Delete,
  Download,
  Edit,
  Stop,
  Tv,
} from '@mui/icons-material';
import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Channel } from '@tunarr/types';
import { isEmpty, trimEnd } from 'lodash-es';
import { useSnackbar } from 'notistack';
import type { SyntheticEvent } from 'react';
import { useCallback, useState } from 'react';
import { deleteApiChannelsByIdSessionsMutation } from '../../generated/@tanstack/react-query.gen.ts';
import { getApiErrorMessage } from '../../helpers/apiError.ts';
import { invalidateTaggedQueries } from '../../helpers/queryUtil.ts';
import { isNonEmptyString } from '../../helpers/util.ts';
import {
  fetchChannelBlueprint,
  useImportBlueprint,
} from '../../hooks/useBlueprints.ts';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard.ts';
import { useCreateChannel } from '../../hooks/useCreateChannel.ts';
import { useSettings } from '../../store/settings/selectors.ts';
import type { PopoverAnchorEl } from '../../types/dom.ts';
import { downloadBlueprint } from '../blueprints/blueprintFile.ts';
import { ChannelDeleteDialog } from './ChannelDeleteDialog.tsx';

type Props = {
  row: Channel;
  anchorEl: PopoverAnchorEl;
  open: boolean;
  onClose: (e?: SyntheticEvent) => void;
  hideItems?: channelListOptions[];

  // ID of the button that opens the menu, which names it for screen readers.
  labelledBy?: string;
};

export const ChannelOptionsMenu = ({
  row,
  anchorEl,
  open,
  onClose,
  hideItems,
  labelledBy,
}: Props) => {
  const { backendUri } = useSettings();
  const copyToClipboard = useCopyToClipboard();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const { t } = useLingui();

  const queryClient = useQueryClient();
  const stopSessionsMutation = useMutation({
    ...deleteApiChannelsByIdSessionsMutation(),
    onSuccess: () => {
      return queryClient.invalidateQueries({
        predicate: invalidateTaggedQueries(['Channels']),
      });
    },
  });

  const handleStopSessions = useCallback(
    (channelId: string) => {
      stopSessionsMutation.mutate({ path: { id: channelId } });
    },
    [stopSessionsMutation],
  );

  const duplicateChannelMutation = useCreateChannel();

  // A slot channel whose slots all play smart collections reads back as a
  // blueprint; any other channel answers with the slot that blocks it.
  const snackbar = useSnackbar();
  const importBlueprintMutation = useImportBlueprint();
  const withChannelBlueprint = useCallback(
    (action: 'save' | 'export') => {
      fetchChannelBlueprint(row.id)
        .then((blueprint) => {
          if (action === 'export') {
            downloadBlueprint(blueprint);
            return;
          }
          importBlueprintMutation.mutate(blueprint, {
            onSuccess: () => {
              snackbar.enqueueSnackbar({
                variant: 'success',
                message: t`Saved “${row.name}” as a blueprint`,
              });
            },
          });
        })
        .catch((err: unknown) => {
          snackbar.enqueueSnackbar({
            variant: 'error',
            message:
              getApiErrorMessage(err) ??
              t`This channel cannot be saved as a blueprint`,
          });
        });
    },
    [importBlueprintMutation, row.id, row.name, snackbar, t],
  );

  const handleClose = useCallback(
    (e: SyntheticEvent) => {
      e.stopPropagation();
      onClose(e);
    },
    [onClose],
  );

  const { id: channelId, name: channelName, sessions } = row;

  return (
    <>
      <Menu
        id="channel-options-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        slotProps={{
          list: {
            'aria-labelledby': labelledBy,
          },
        }}
      >
        {!hideItems?.includes('edit') ? (
          <MenuItem
            to={`/channels/${channelId}/edit`}
            component={Link}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <ListItemIcon>
              <Edit />
            </ListItemIcon>
            <ListItemText>
              <Trans>Edit Channel</Trans>
            </ListItemText>
          </MenuItem>
        ) : null}

        {!hideItems?.includes('programming') ? (
          <MenuItem
            to={`/channels/${channelId}/programming`}
            component={Link}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <ListItemIcon>
              <Edit />
            </ListItemIcon>
            <ListItemText>
              <Trans>Modify Programming</Trans>
            </ListItemText>
          </MenuItem>
        ) : null}

        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            const base = isNonEmptyString(backendUri)
              ? backendUri
              : window.location.origin;
            const url = `${trimEnd(
              base,
              '/',
            )}/stream/channels/${row.number}.m3u8`;
            copyToClipboard(
              url,
              t`Copied channel "${channelName}" m3u link to clipboard`,
              t`Error copying channel m3u link to clipboard`,
            )
              .catch(console.error)
              .finally(() => {
                onClose();
              });
          }}
        >
          <ListItemIcon>
            <ContentCopy />
          </ListItemIcon>
          <ListItemText>
            <Trans>Copy M3U URL</Trans>
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard(channelId, t`Copied Channel ID!`)
              .catch(console.error)
              .finally(() => {
                onClose(e);
              });
          }}
        >
          <ListItemIcon>
            <ContentCopy />
          </ListItemIcon>
          <ListItemText>
            <Trans>Copy Channel ID</Trans>
          </ListItemText>
        </MenuItem>

        {!hideItems?.includes('watch') ? (
          <MenuItem
            component={Link}
            to={`/channels/${channelId}/watch`}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <ListItemIcon>
              <Tv />
            </ListItemIcon>
            <ListItemText>
              <Trans>Watch Channel</Trans>
            </ListItemText>
          </MenuItem>
        ) : null}
        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            handleStopSessions(channelId);
            onClose(e);
          }}
          disabled={isEmpty(sessions)}
        >
          <ListItemIcon>
            <Stop />
          </ListItemIcon>
          <ListItemText primary={t`Stop Transcode Session`} />
        </MenuItem>
        {!hideItems?.includes('duplicate') && (
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              duplicateChannelMutation.mutate({
                body: {
                  type: 'copy',
                  channelId,
                },
              });
              handleClose(e);
            }}
          >
            <ListItemIcon>
              <CopyAll />{' '}
            </ListItemIcon>
            <ListItemText>
              <Trans>Duplicate Channel</Trans>
            </ListItemText>
          </MenuItem>
        )}
        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            withChannelBlueprint('save');
            onClose(e);
          }}
        >
          <ListItemIcon>
            <Architecture />
          </ListItemIcon>
          <ListItemText>
            <Trans>Save as Blueprint</Trans>
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            withChannelBlueprint('export');
            onClose(e);
          }}
        >
          <ListItemIcon>
            <Download />
          </ListItemIcon>
          <ListItemText>
            <Trans>Export as Blueprint</Trans>
          </ListItemText>
        </MenuItem>
        {!hideItems?.includes('delete') && (
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              setDeleteConfirmOpen(true);
            }}
          >
            <ListItemIcon>
              <Delete />
            </ListItemIcon>
            <ListItemText>
              <Trans>Delete Channel</Trans>
            </ListItemText>
          </MenuItem>
        )}
      </Menu>
      <ChannelDeleteDialog
        open={deleteConfirmOpen}
        onClose={(e) => {
          setDeleteConfirmOpen(false);
          handleClose(e);
        }}
        channel={row}
      />
    </>
  );
};
