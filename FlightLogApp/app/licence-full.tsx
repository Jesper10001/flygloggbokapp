// Next licence i liggande helskärm, öppnas med knappen bredvid kortets rubrik i Insights.
import { FullscreenShell } from '../components/insights/FullscreenShell';
import { LicenceFull } from '../components/insights/LicenceFull';

export default function LicenceFullScreen() {
  return <FullscreenShell>{(close) => <LicenceFull onClose={close} />}</FullscreenShell>;
}
