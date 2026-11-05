import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { answerEvents, encodeEvents, hangingSseResponse, SOURCES, sseResponse } from './test/sseResponse.ts';

function mockFetch(impl: (init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((_url: string, init: RequestInit) => Promise.resolve(impl(init)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function ask(question: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/ask a question/i), `${question}{Enter}`);
  return user;
}

describe('<App>', () => {
  it('streams an answer and shows only the sources it cited', async () => {
    const fetchMock = mockFetch(() =>
      sseResponse(encodeEvents(answerEvents(['Yes, within ', '30 days of purchase [1].'], [1]))),
    );
    render(<App />);
    await ask('Can I get a refund on an annual plan?');

    expect(await screen.findByText(/within 30 days of purchase/)).toBeInTheDocument();
    const sources = await screen.findByRole('region', { name: 'Sources' });
    expect(within(sources).getByText('Billing and Refunds')).toBeInTheDocument();
    expect(within(sources).queryByText('Plans and Pricing')).not.toBeInTheDocument();

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({ question: 'Can I get a refund on an annual plan?', history: [] });
  });

  it('highlights the source card when a citation is clicked', async () => {
    mockFetch(() => sseResponse(encodeEvents(answerEvents(['Within 30 days [1].'], [1]))));
    render(<App />);
    const user = await ask('Refund?');

    await user.click(await screen.findByRole('button', { name: /^Source 1:/ }));
    const card = screen.getByText('Billing and Refunds').closest('li');
    await waitFor(() => expect(card).toHaveClass('source--active'));
  });

  it('sends earlier turns as history for follow-up questions', async () => {
    const fetchMock = mockFetch(() => sseResponse(encodeEvents(answerEvents(['Within 30 days [1].'], [1]))));
    render(<App />);
    await ask('Refund on annual?');
    await screen.findByRole('region', { name: 'Sources' });
    await ask('And monthly?');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(body.history).toEqual([
      { role: 'user', content: 'Refund on annual?' },
      { role: 'assistant', content: 'Within 30 days [1].' },
    ]);
  });

  it('shows a "not found" answer as a notice without sources', async () => {
    const text = "I couldn't find this in the documentation.";
    mockFetch(() =>
      sseResponse(
        encodeEvents([
          { event: 'sources', data: [] },
          { event: 'delta', data: { text } },
          { event: 'done', data: { cited: [], notFound: true, requestId: 'r' } },
        ]),
      ),
    );
    render(<App />);
    await ask('Capital of France?');

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /sources|passages/i })).not.toBeInTheDocument();
  });

  it('shows the server error message and retries on request', async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: 'Too many questions in a short time.' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return sseResponse(encodeEvents(answerEvents(['Recovered [2].'], [2])));
    });
    render(<App />);
    const user = await ask('Refund?');

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many questions in a short time.');
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/Recovered/)).toBeInTheDocument();
    expect(screen.getAllByText('Refund?')).toHaveLength(1); // retried in place, not duplicated
  });

  it('can stop an answer mid-stream', async () => {
    mockFetch((init) =>
      hangingSseResponse(init.signal, [
        { event: 'sources', data: SOURCES },
        { event: 'delta', data: { text: 'Partial answer' } },
      ]),
    );
    render(<App />);
    const user = await ask('Refund?');

    expect(await screen.findByText(/Partial answer/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /stop answering/i }));
    expect(await screen.findByText('Answer stopped.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send question/i })).toBeInTheDocument();
  });

  it('asks a suggested question with one click', async () => {
    const fetchMock = mockFetch(() => sseResponse(encodeEvents(answerEvents(['Ok [1].'], [1]))));
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'How do I connect Slack?' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(screen.getByText('How do I connect Slack?')).toBeInTheDocument();
  });
});
