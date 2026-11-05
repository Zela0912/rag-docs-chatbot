import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SOURCES } from '../test/sseResponse.ts';
import { AnswerMarkdown, linkCitations } from './AnswerMarkdown.tsx';

describe('linkCitations', () => {
  const valid = new Set([1, 2]);

  it('links known source ids, including grouped ones', () => {
    expect(linkCitations('A [1]. B [1, 2].', valid)).toBe('A [1](#cite-1). B [1](#cite-1)[2](#cite-2).');
  });

  it('leaves unknown ids as plain text so the model cannot invent a citation', () => {
    expect(linkCitations('C [7].', valid)).toBe('C [7].');
  });
});

describe('<AnswerMarkdown>', () => {
  it('renders citations as accessible buttons that report the source id', async () => {
    const onCite = vi.fn();
    render(<AnswerMarkdown content="Refunds within 30 days [1]." sources={SOURCES} onCite={onCite} />);

    const button = screen.getByRole('button', { name: 'Source 1: Billing and Refunds, Refunds' });
    await userEvent.click(button);
    expect(onCite).toHaveBeenCalledWith(1);
  });

  it('renders inert badges while there is no click handler', () => {
    render(<AnswerMarkdown content="Refunds [1]." sources={SOURCES} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('1')).toHaveClass('cite--inert');
  });

  it('opens real links in a new tab without leaking the opener', () => {
    render(<AnswerMarkdown content="See [status page](https://status.example.com)." sources={SOURCES} />);
    const link = screen.getByRole('link', { name: 'status page' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('never renders raw HTML from the model', () => {
    const { container } = render(<AnswerMarkdown content={'<img src=x onerror="alert(1)">Hi'} sources={[]} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
