import { describe, expect, it } from 'vitest';
import {
  COMPETENCIES,
  MINIMUM_COMMENT_LENGTH,
  MINIMUM_RETURN_REASON_LENGTH,
  REACHABLE_OVERALL_TENTHS,
  bandFor,
  isValidRating,
  overallTenths,
} from './evaluation';

// MR-REV-01 and MR-REV-02. The overall score is held in tenths as an integer for the same
// reason Storefront holds money in cents: the rule rounds half-up to one decimal place, and
// asserting on a binary float would be asserting on the wrong thing.

describe('MR-REV-01 the rating scale', () => {
  it('rates exactly four fixed competencies', () => {
    expect(COMPETENCIES).toEqual([
      'Quality of Work',
      'Reliability',
      'Collaboration',
      'Initiative',
    ]);
  });

  it.each([
    [0, false],
    [1, true],
    [2, true],
    [4, true],
    [5, true],
    [6, false],
  ])('treats %s as valid=%s', (value, valid) => {
    expect(isValidRating(value)).toBe(valid);
  });

  it('rejects the equivalence values the rule calls out by name', () => {
    expect(isValidRating(3.5)).toBe(false);
    expect(isValidRating('4')).toBe(false);
    expect(isValidRating(null)).toBe(false);
    expect(isValidRating(undefined)).toBe(false);
  });
});

describe('MR-REV-02 the overall score', () => {
  it('is null when any competency is unrated', () => {
    expect(overallTenths([4, 4, 4, null])).toBeNull();
    expect(overallTenths([null, null, null, null])).toBeNull();
  });

  it('does not treat an unrated competency as zero', () => {
    // A rating of zero is not even valid, so a mean that includes one is doubly wrong.
    expect(overallTenths([4, 4, 4, null])).not.toBe(30);
  });

  it('reproduces the published worked values', () => {
    expect(overallTenths([4, 4, 4, 3])).toBe(38);
    expect(overallTenths([3, 3, 3, 4])).toBe(33);
    expect(overallTenths([4, 3, 5, 4])).toBe(40);
  });

  it('rounds half-up rather than half-even', () => {
    // 15 / 4 = 3.75 exactly. Half-even would give 3.8 here but 3.2 for 13 / 4 = 3.25.
    expect(overallTenths([4, 4, 4, 3])).toBe(38);
    expect(overallTenths([3, 3, 3, 4])).toBe(33);
    expect(overallTenths([3, 3, 3, 4])).not.toBe(32);
  });

  it('can only produce the 17 reachable values', () => {
    const produced = new Set<number>();
    for (let a = 1; a <= 5; a++)
      for (let b = 1; b <= 5; b++)
        for (let c = 1; c <= 5; c++)
          for (let d = 1; d <= 5; d++) produced.add(overallTenths([a, b, c, d]) as number);

    expect([...produced].sort((x, y) => x - y)).toEqual(REACHABLE_OVERALL_TENTHS);
    expect(produced.size).toBe(17);
    // A test case expecting 4.4 or 3.1 is testing a value the system cannot produce.
    expect(produced.has(44)).toBe(false);
    expect(produced.has(31)).toBe(false);
  });

  it('spans 1.0 to 5.0', () => {
    expect(overallTenths([1, 1, 1, 1])).toBe(10);
    expect(overallTenths([5, 5, 5, 5])).toBe(50);
  });
});

describe('MR-REV-02 outcome bands', () => {
  it('has no band when the overall score is null', () => {
    expect(bandFor(null)).toBeNull();
  });

  it('puts exactly 3.0 in Meets Expectations, not Needs Improvement', () => {
    // Ratings 3, 3, 3, 3. This is where a > written in place of >= changes an outcome.
    expect(overallTenths([3, 3, 3, 3])).toBe(30);
    expect(bandFor(30)).toBe('Meets Expectations');
  });

  it('puts exactly 4.5 in Exceeds Expectations', () => {
    // Ratings 5, 5, 4, 4.
    expect(overallTenths([5, 5, 4, 4])).toBe(45);
    expect(bandFor(45)).toBe('Exceeds Expectations');
  });

  it('puts the value just below each edge in the lower band', () => {
    expect(bandFor(28)).toBe('Needs Improvement');
    expect(bandFor(43)).toBe('Meets Expectations');
  });

  it('bands every reachable value', () => {
    for (const tenths of REACHABLE_OVERALL_TENTHS) {
      expect(bandFor(tenths)).not.toBeNull();
    }
  });
});

describe('MR-REV-03 guard lengths', () => {
  it('requires 20 characters of comment and 10 of return reason', () => {
    expect(MINIMUM_COMMENT_LENGTH).toBe(20);
    expect(MINIMUM_RETURN_REASON_LENGTH).toBe(10);
  });
});
