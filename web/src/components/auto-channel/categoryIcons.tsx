import {
  Business,
  CalendarMonth,
  Category,
  LiveTv,
  Movie,
  MusicNote,
  Person,
  PlaylistPlay,
  Shuffle,
  Tune,
} from '@mui/icons-material';
import type { ChannelPresetCategory } from '@tunarr/types/api';
import type { ReactNode } from 'react';

// One icon per preset category, shared by preset and blueprint cards.
export const categoryIcons: Record<ChannelPresetCategory, ReactNode> = {
  simple: <Shuffle />,
  'classic-tv': <LiveTv />,
  movie: <Movie />,
  music: <MusicNote />,
  binge: <PlaylistPlay />,
  genre: <Category />,
  people: <Person />,
  decade: <CalendarMonth />,
  network: <Business />,
  custom: <Tune />,
};
