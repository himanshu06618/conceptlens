import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import CourseStatusCard from '../components/planner/CourseStatusCard';
import { generateConceptsTxt } from '../utils/exportUtils';

describe('CourseStatusCard — Active Study Plan Pacing', () => {
  it('renders inactive state when no active plan is started', () => {
    const { getByText, container } = render(
      <MemoryRouter>
        <CourseStatusCard activePlan={null} planStatus={null} />
      </MemoryRouter>
    );

    expect(getByText(/No Active Plan/i)).toBeTruthy();
    expect(getByText(/Inactive/i)).toBeTruthy();
    expect(getByText(/Start Study Plan/i)).toBeTruthy();

    // All 7 weekday bars should be at bottom (8px)
    const chart = container.querySelector('[role="img"]');
    expect(chart).toBeTruthy();
    expect(chart.children.length).toBe(7);

    Array.from(chart.children).forEach((col) => {
      const pill = col.firstElementChild;
      expect(pill.style.height).toBe('8px');
    });
  });

  it('activates and displays day progress and "On track" when plan is active', () => {
    const activePlan = { id: 'plan-1', days: 7, start_date: '2026-10-18' };
    const planStatus = { today_index: 3, total_days: 7, behind: 0, on_track: true };

    const { getByText } = render(
      <MemoryRouter>
        <CourseStatusCard activePlan={activePlan} planStatus={planStatus} />
      </MemoryRouter>
    );

    expect(getByText(/Day 3 of 7/i)).toBeTruthy();
    expect(getByText(/On track/i)).toBeTruthy();
    expect(getByText(/Manage Study Route/i)).toBeTruthy();
  });

  it('tracks daily concept completion rate: bar goes up with concepts and stays at bottom when 0', () => {
    const activePlan = { id: 'plan-1', days: 7 };
    const planStatus = { today_index: 1, total_days: 7, behind: 0 };

    // Find current Monday in local time
    const now = new Date();
    const currentDayOfWeek = (now.getDay() + 6) % 7; // 0 for Mon
    const monday = new Date(now);
    monday.setDate(now.getDate() - currentDayOfWeek);
    monday.setHours(12, 0, 0, 0);

    // Complete 2 concepts on Monday
    const mondayTs1 = new Date(monday).toISOString();
    const mondayTs2 = new Date(monday.getTime() + 3600000).toISOString();

    const { container } = render(
      <MemoryRouter>
        <CourseStatusCard
          activePlan={activePlan}
          planStatus={planStatus}
          activeTimestamps={[mondayTs1, mondayTs2]}
          completedConceptsCount={2}
        />
      </MemoryRouter>
    );

    const chart = container.querySelector('[role="img"]');
    const mondayPill = chart.children[0].querySelector('div');
    // For 2 concepts on Monday: 28 + (2 - 1) * 16 = 44px (went up!)
    expect(mondayPill.style.height).toBe('44px');

    // For days with 0 completions (e.g. Tuesday if today is Monday, or other 0 days): stays at bottom (8px)
    const tuesdayPill = chart.children[1].querySelector('div');
    if (currentDayOfWeek !== 1) {
      expect(tuesdayPill.style.height).toBe('8px');
    }
  });

  it('scales bar height up further when user completes more concepts (x+1, x+2...)', () => {
    const activePlan = { id: 'plan-1', days: 15 };
    const planStatus = { today_index: 1, total_days: 15, behind: 0 };

    const now = new Date();
    const currentDayOfWeek = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - currentDayOfWeek);
    monday.setHours(10, 0, 0, 0);

    // 4 concepts on Monday
    const timestamps = [
      new Date(monday.getTime() + 1000).toISOString(),
      new Date(monday.getTime() + 2000).toISOString(),
      new Date(monday.getTime() + 3000).toISOString(),
      new Date(monday.getTime() + 4000).toISOString(),
    ];

    const { container } = render(
      <MemoryRouter>
        <CourseStatusCard
          activePlan={activePlan}
          planStatus={planStatus}
          activeTimestamps={timestamps}
          completedConceptsCount={4}
        />
      </MemoryRouter>
    );

    const chart = container.querySelector('[role="img"]');
    const mondayPill = chart.children[0].querySelector('div');
    // 28 + (4 - 1) * 16 = 76px
    expect(mondayPill.style.height).toBe('76px');
  });

  it('displays "X days behind" badge when plan is behind schedule', () => {
    const activePlan = { id: 'plan-1', days: 7 };
    const planStatus = { today_index: 4, total_days: 7, behind: 2 };

    const { getByText } = render(
      <MemoryRouter>
        <CourseStatusCard activePlan={activePlan} planStatus={planStatus} />
      </MemoryRouter>
    );

    expect(getByText(/2 days behind/i)).toBeTruthy();
  });
});

describe('Export Utils — Plain Text (.txt) Export', () => {
  it('generates a clean plain text file with document filename and concept titles only', async () => {
    const docData = {
      title: 'Lecture 3: Sorting Algorithms',
      filename: 'lecture_3.pdf',
      created_at: '2026-10-20T00:00:00Z'
    };

    const concepts = [
      {
        id: 'c1',
        name: 'Bubble Sort',
        importance: 3,
        status: 'not_started',
        estimated_minutes: 5,
        chapter: 'Sorting Basics',
        definition: 'Comparison-based sorting algorithm.',
        source_page: 2
      },
      {
        id: 'c2',
        name: 'Quick Sort',
        importance: 5,
        status: 'studied',
        estimated_minutes: 10,
        chapter: 'Divide and Conquer',
        definition: 'Partitioning-based recursive algorithm.',
        source_page: 6
      }
    ];

    const blob = generateConceptsTxt(docData, concepts);
    expect(blob).toBeTruthy();
    expect(blob.type).toContain('text/plain');

    const text = await blob.text();
    expect(text).toContain('File: lecture_3.pdf');
    expect(text).toContain('1. Bubble Sort');
    expect(text).toContain('2. Quick Sort');
    expect(text).not.toContain('CONCEPTLENS STUDY GUIDE');
    expect(text).not.toContain('[TABLE OF CONTENTS]');
    expect(text).not.toContain('CHAPTER 1:');
    expect(text).not.toContain('Comparison-based sorting algorithm.');
  });
});
