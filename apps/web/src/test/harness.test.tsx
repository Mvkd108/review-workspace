import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Harness } from '../harness/Harness';

describe('fixture harness', () => {
  it('renders the first fixture and switches scenarios', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText('Fixture harness')).toBeInTheDocument();
    expect(await screen.findByText('Observe your first worktree')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Scenario'), 'One healthy work unit');
    expect(await screen.findByRole('heading', { level: 1, name: 'Add retry handling to the API client' })).toBeInTheDocument();
  });
});
