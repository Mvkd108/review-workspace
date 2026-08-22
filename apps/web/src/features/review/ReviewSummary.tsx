import type { WorkUnitView } from '@review-workspace/schema';
import { Icon } from '../../components/Icon';
import { StatusPill } from '../../components/Pill';
import { readinessNextAction } from '../gates/gateStatus';

export function ReviewSummary({ view }: { view: WorkUnitView }) {
  const nextAction = readinessNextAction(view);
  return (
    <section className="summary-grid">
      <article className="panel attention-panel">
        <div className="panel-title"><span><Icon name="warning" />Why it needs attention</span><span className={`risk-label risk-${view.risk.level}`}>{view.risk.level}</span></div>
        {view.risk.reasons.length
          ? <ul className="reason-list">{view.risk.reasons.map((item) => <li key={item.code}><strong>{item.label}</strong><span>{item.detail}</span></li>)}</ul>
          : <div className="positive"><Icon name="check" /><span>No elevated risk reasons detected.</span></div>}
      </article>
      <article className="panel readiness-panel">
        <div className="panel-title"><span><Icon name={view.mergeReadiness.status === 'ready' ? 'check' : 'branch'} />Merge readiness</span><StatusPill status={view.mergeReadiness.status} /></div>
        <ul className="plain-list">{view.mergeReadiness.reasons.map((item) => <li key={item}>{item}</li>)}</ul>
        {nextAction && (
          <div className="readiness-next"><Icon name="warning" /><span>Next: {nextAction}</span></div>
        )}
      </article>
    </section>
  );
}
