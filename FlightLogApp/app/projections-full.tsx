// Projections i liggande helskärm, öppnas med knappen bredvid kortets rubrik i Insights.
import { FullscreenShell } from '../components/insights/FullscreenShell';
import { ProjectionsFull } from '../components/insights/ProjectionsFull';

export default function ProjectionsFullScreen() {
  return <FullscreenShell>{(close) => <ProjectionsFull onClose={close} />}</FullscreenShell>;
}
