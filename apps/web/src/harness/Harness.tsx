import { useState } from 'react';
import { App } from '../App';
import { fixtures } from '../fixtures/workspaces';
import { stubApi } from './StubApi';
import './harness.css';

export function Harness() {
  const [index, setIndex] = useState(0);
  const fixture = fixtures[index] ?? fixtures[0]!;
  return (
    <div className="harness">
      <header className="harness-bar">
        <div className="harness-copy">
          <strong>Fixture harness</strong>
          <span>{fixture.description}</span>
        </div>
        <label className="harness-picker">
          Scenario
          <select value={fixture.name} onChange={(event) => setIndex(fixtures.findIndex((candidate) => candidate.name === event.target.value))}>
            {fixtures.map((candidate) => <option key={candidate.name} value={candidate.name}>{candidate.name}</option>)}
          </select>
        </label>
      </header>
      <div className="harness-stage">
        <App key={fixture.name} api={stubApi(fixture)} />
      </div>
    </div>
  );
}
