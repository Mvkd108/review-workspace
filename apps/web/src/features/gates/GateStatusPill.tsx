import { Icon, type IconName } from '../../components/Icon';
import { GATE_STATE_COPY, type GateState } from './gateStatus';

const STATE_ICON: Record<GateState, IconName> = {
  missing: 'file',
  running: 'refresh',
  passed: 'check',
  failed: 'close',
  stale: 'warning',
};

export function GateStatusPill({ state }: { state: GateState }) {
  return (
    <span className={`gate-status-pill gate-pill-${state}`}>
      <Icon name={STATE_ICON[state]} />
      {GATE_STATE_COPY[state]}
    </span>
  );
}
