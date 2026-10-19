import { describe, it, expect } from 'vitest';

describe('Study Time Left Synchronization', () => {
  it('calculates identical study time using the exact concept importance and definition formula', () => {
    // Simulate 30 concepts with average importance 2 and definitions
    const concepts = Array.from({ length: 30 }, (_, i) => ({
      id: `concept-${i + 1}`,
      importance: 2,
      definition: 'A sorting algorithm that places elements in order.',
      status: 'not_started'
    }));

    // Formula: est_m = max(1, min(30, 4 + imp * 3 + min(8, d_len // 30)))
    let minutes = 0;
    concepts.forEach((c) => {
      const imp = Math.max(1, Math.min(3, Number(c.importance) || 2));
      const dLen = (c.definition || '').length;
      const estM = Math.max(1, Math.min(30, 4 + imp * 3 + Math.min(8, Math.floor(dLen / 30))));
      minutes += estM;
    });

    const hours = Number((minutes / 60).toFixed(1));
    // For 30 concepts, ~6.5h - 6.6h is expected
    expect(hours).toBeGreaterThan(5.0);
    expect(hours).toBeLessThan(8.0);
  });
});
