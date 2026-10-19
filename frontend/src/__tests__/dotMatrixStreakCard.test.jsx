import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import DotMatrixStreakCard from '../components/ui/DotMatrixStreakCard';

describe('DotMatrixStreakCard — Study Consistency', () => {
  it('renders month name and exactly 31 circular day shapes', () => {
    const { container, getByText, queryByText } = render(
      <DotMatrixStreakCard
        completedConceptsCount={0}
        monthName="October"
        year={2026}
      />
    );

    // Month name should be displayed
    expect(getByText(/October 2026/i)).toBeTruthy();

    // Rating (e.g. 9.2 or / 10) must NOT be present
    expect(queryByText('/ 10')).toBeNull();
    expect(queryByText('9.2')).toBeNull();

    // Exactly 31 day shapes
    const dayGrid = container.querySelector('[role="img"]');
    expect(dayGrid).toBeTruthy();
    expect(dayGrid.children.length).toBe(31);
  });

  it('does not glow any day shapes when completedConceptsCount is 0', () => {
    const { container, getByText } = render(
      <DotMatrixStreakCard
        completedConceptsCount={0}
        activeDays={[1, 2, 3]}
        monthName="October"
        year={2026}
      />
    );

    expect(getByText(/0 concepts completed · Inactive/i)).toBeTruthy();

    const dayGrid = container.querySelector('[role="img"]');
    const glowingDays = Array.from(dayGrid.children).filter(
      (el) => el.style.boxShadow && el.style.boxShadow !== 'none'
    );
    expect(glowingDays.length).toBe(0);
  });

  it('glows active day shapes when completedConceptsCount > 0', () => {
    const { container } = render(
      <DotMatrixStreakCard
        completedConceptsCount={5}
        activeDays={[20]}
        monthName="October"
        year={2026}
      />
    );

    const dayGrid = container.querySelector('[role="img"]');
    const day20 = Array.from(dayGrid.children).find((el) => el.textContent === '20');
    expect(day20).toBeTruthy();
    expect(day20.style.boxShadow).toContain('rgba(215, 242, 92');
  });
});
