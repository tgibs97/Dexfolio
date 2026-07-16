import type { CollectionSummary } from '../../shared/types';

/** Shows overall collection completion plus one progress bar per generation. */
export function Dashboard({
  summary,
  onOpenCard,
}: {
  summary: CollectionSummary;
  onOpenCard: (pokemonId: number) => void;
}) {
  // Moving the dashed SVG stroke reveals the completed portion of the ring.
  const circumference = 2 * Math.PI * 54;
  return (
    <section className="dashboard" aria-labelledby="progress-title">
      <div className="progress-hero">
        <div className="progress-ring" aria-label={`${summary.percentage}% collected`}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className="ring-track" cx="60" cy="60" r="54" />
            <circle
              className="ring-value"
              cx="60"
              cy="60"
              r="54"
              style={{
                strokeDasharray: circumference,
                strokeDashoffset: circumference - (summary.percentage / 100) * circumference,
              }}
            />
          </svg>
          <strong>{summary.percentage}%</strong>
        </div>
        <div>
          <p className="eyebrow">Collection progress</p>
          <h2 id="progress-title">
            <span>{summary.collected.toLocaleString()}</span> / {summary.total.toLocaleString()} collected
          </h2>
        </div>
      </div>
      <div className="generation-progress" aria-label="Progress by generation">
        {summary.generations.map((item) => (
          <div className="generation-row" key={item.generation}>
            <span>Gen {roman(item.generation)}</span>
            <div className="bar">
              <span style={{ width: `${item.percentage}%` }} />
            </div>
            <small>
              {item.collected}/{item.total}
            </small>
          </div>
        ))}
      </div>
      <dl className="collection-finances" aria-label="Collection finances">
        <Finance label="Total spent" value={money(summary.totalSpentCents)} />
        <Finance label="Total value" value={money(summary.totalValueCents)} />
        <Finance
          label="Average card value"
          value={summary.averageCardValueCents === null ? '—' : money(summary.averageCardValueCents)}
        />
        <ValueCardFinance label="Highest value card" card={summary.highestValueCard} onOpenCard={onOpenCard} />
        <ValueCardFinance label="Lowest value card" card={summary.lowestValueCard} onOpenCard={onOpenCard} />
      </dl>
    </section>
  );
}

function ValueCardFinance({
  label,
  card,
  onOpenCard,
}: {
  label: string;
  card: CollectionSummary['highestValueCard'];
  onOpenCard: (pokemonId: number) => void;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{card ? money(card.cents) : '—'}</dd>
      {card && (
        <small>
          <button type="button" onClick={() => onOpenCard(card.pokemonId)}>
            {card.pokemonName} · {card.cardName}
          </button>
        </small>
      )}
    </div>
  );
}

function Finance({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

// Roman numerals keep the generation labels compact.
function roman(value: number) {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][value - 1] ?? value;
}
