import { Card, CardActionArea, CardContent, Typography } from '@mui/material';
import type { ChannelPreset } from '@tunarr/types/api';
import { categoryIcons } from './categoryIcons.tsx';

type PresetCardProps = {
  preset: ChannelPreset;
  selected: boolean;
  onClick: () => void;
};

export function PresetCard({ preset, selected, onClick }: PresetCardProps) {
  return (
    <Card
      variant={selected ? 'elevation' : 'outlined'}
      sx={{
        border: selected ? 2 : 1,
        borderColor: selected ? 'primary.main' : 'divider',
        transition: 'border-color 0.2s',
        height: '100%',
      }}
    >
      <CardActionArea
        onClick={onClick}
        sx={{
          p: 2,
          height: '100%',
          display: 'flex',
          alignItems: 'flex-start',
        }}
      >
        <CardContent sx={{ textAlign: 'center', p: 1, width: '100%' }}>
          {categoryIcons[preset.category]}
          <Typography variant="h6" sx={{ mt: 1 }}>
            {preset.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {preset.description}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
