'use client';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FeedbackBanner } from './feedback-banner';

describe('FeedbackBanner', () => {
  it('renders error feedback as an alert', () => {
    render(<FeedbackBanner tone="error">Something went wrong</FeedbackBanner>);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('renders recoverable guidance actions when provided', () => {
    render(
      <FeedbackBanner
        tone="notice"
        actions={<button type="button">Retry now</button>}
      >
        Guidance available
      </FeedbackBanner>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Guidance available');
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument();
  });
});
