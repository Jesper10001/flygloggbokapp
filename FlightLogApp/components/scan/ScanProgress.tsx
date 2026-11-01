import { BladeProgress } from '../BladeProgress';

// Skärmen medan Claude läser loggboken (stående). Samma laddskärm som CSV/Excel-importen (BladeProgress):
// Blade-myntet snurrar, under det etikett, förlopp med tid och stegen. När läsningen är klar stannar myntet
// framåtvänt med en bock, och scan-review tonar över till sidan.

export type ScanPhase = 'finding' | 'reading' | 'done' | 'error';

export function ScanProgress({ phase, spread, spreads, summary, error, onClose, onRetry, startedAt, outOfCoins, coinsLabel, onGetCoins }: {
  phase: ScanPhase;
  spread: number;             // 1-baserat
  spreads: number;
  summary?: { flights: number; open: number };
  error?: string;
  startedAt: number;          // Date.now() när läsningen började
  onClose: () => void;
  onRetry: () => void;
  outOfCoins?: boolean;       // läsningen stannade för att coinsen tog slut — fotona finns kvar
  coinsLabel?: string;        // "Get more coins" (Premium) eller "See Premium"
  onGetCoins?: () => void;
}) {
  const eyebrow = phase === 'error' && outOfCoins ? 'OUT OF BLADE COINS' : phase === 'error' ? 'SCAN STOPPED'
    : phase === 'done' ? 'SCAN COMPLETE'
      : spreads > 1 ? `SCANNING · SPREAD ${spread} OF ${spreads}` : 'SCANNING';
  const title = phase === 'error' && outOfCoins ? 'You’re out of Blade coins' : phase === 'error' ? "Couldn't read the page"
    : phase === 'done' && summary ? (summary.flights === 1 ? '1 flight read' : `${summary.flights} flights read`)
      : 'Reading your logbook';
  const body = phase === 'error' && outOfCoins ? 'Your photos are kept. Get more coins and the scan continues where it stopped.'
    : phase === 'error' ? (error || 'Something went wrong while reading the page.')
    : phase === 'done' && summary ? (summary.open > 0 ? `${summary.open} ${summary.open === 1 ? 'thing needs' : 'things need'} a look. Opening the page…` : 'Everything looks right. Opening the page…')
      : phase === 'finding' ? 'Finding the logbook in the photo.'
        : 'Claude reads every row and column. This usually takes about half a minute.';

  return (
    <BladeProgress
      status={phase === 'done' ? 'done' : phase === 'error' ? 'error' : 'busy'}
      eyebrow={eyebrow}
      title={title}
      body={body}
      steps={[
        { label: 'Locate the logbook', state: phase === 'finding' ? 'active' : 'done' },
        { label: 'Read every row', state: phase === 'reading' ? 'active' : phase === 'done' ? 'done' : 'todo' },
        { label: 'Mark what needs a check', state: phase === 'done' ? 'done' : 'todo' },
      ]}
      progress={phase === 'finding' ? 0.12 : 0.92}
      progressMs={phase === 'finding' ? 2500 : 34000}
      startedAt={startedAt}
      footnote="Nothing is saved until you approve it."
      onClose={onClose}
      closeLabel="Cancel scan"
      onRetry={onRetry}
      action={phase === 'error' && outOfCoins && onGetCoins ? { label: coinsLabel ?? 'Get more coins', onPress: onGetCoins } : undefined}
    />
  );
}
