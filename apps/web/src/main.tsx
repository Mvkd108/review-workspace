import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';

const params = new URLSearchParams(window.location.search);
const root = createRoot(document.getElementById('root')!);

if (params.has('harness')) {
  const { Harness } = await import('./harness/Harness');
  root.render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
