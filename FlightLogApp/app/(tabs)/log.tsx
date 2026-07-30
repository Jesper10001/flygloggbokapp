// Book-fliken: pilot-manned + drone använder den nya loggboken (PilotLogbook).
// (Den gamla operator-loggboken är borttagen tillsammans med operator-rollen.)
import { PilotLogbook } from '../../components/logbook-page/PilotLogbook';

export default function LogScreen() {
  return <PilotLogbook />;
}
