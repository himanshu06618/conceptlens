import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import StatCard from '../components/ui/StatCard';

describe('StatCard progress bar rendering', () => {
  it('does not render an inner filled bar when progress is 0', () => {
    const { container } = render(
      <StatCard
        label="Concepts"
        value={30}
        progress={0}
        progressColor="var(--text)"
      />
    );
    const progressbar = container.querySelector('[role="progressbar"]');
    expect(progressbar).toBeTruthy();
    expect(progressbar.getAttribute('aria-valuenow')).toBe('0');
    // Inner filled bar should not be present when progress is 0
    expect(progressbar.children.length).toBe(0);
  });

  it('defaults to 0 progress and renders no filled bar when progress is omitted', () => {
    const { container } = render(
      <StatCard
        label="Concepts"
        value={0}
      />
    );
    const progressbar = container.querySelector('[role="progressbar"]');
    expect(progressbar).toBeTruthy();
    expect(progressbar.getAttribute('aria-valuenow')).toBe('0');
    expect(progressbar.children.length).toBe(0);
  });

  it('renders filled progress bar with correct width when progress > 0', () => {
    const { container } = render(
      <StatCard
        label="Concepts"
        value={30}
        progress={50}
        progressColor="#B7A9F2"
      />
    );
    const progressbar = container.querySelector('[role="progressbar"]');
    expect(progressbar).toBeTruthy();
    expect(progressbar.getAttribute('aria-valuenow')).toBe('50');
    expect(progressbar.children.length).toBe(1);
    const innerBar = progressbar.children[0];
    expect(innerBar.style.width).toBe('50%');
  });
});
