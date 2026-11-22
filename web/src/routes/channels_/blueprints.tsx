import { BlueprintsPage } from '@/pages/channels/BlueprintsPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/channels_/blueprints')({
  component: () => <BlueprintsPage />,
});
