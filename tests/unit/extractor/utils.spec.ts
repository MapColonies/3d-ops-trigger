import { describe, it, expect } from 'vitest';
import { isEmpty, toUtcDate } from '@src/extractor/utils';

describe('extractor utils', function () {
  describe('isEmpty', function () {
    it.each([undefined, null, '', '   '])('should treat %j as empty', function (value) {
      expect(isEmpty(value)).toBe(true);
    });

    it.each([0, 4326, false, 'AFL', { year: 2025, month: 7, day: 10 }])('should not treat %j as empty', function (value) {
      expect(isEmpty(value)).toBe(false);
    });
  });

  describe('toUtcDate', function () {
    it('should convert the year, month and day object the shapefile reader returns', function () {
      expect(toUtcDate({ year: 2025, month: 7, day: 10 })?.toISOString()).toBe('2025-07-10T00:00:00.000Z');
    });

    it('should parse an ISO date string', function () {
      expect(toUtcDate('2025-07-10T00:00:00.000Z')?.toISOString()).toBe('2025-07-10T00:00:00.000Z');
    });

    it.each(['not a date', 20250710, null, undefined, { year: 2025, month: 7 }, { year: 2025.5, month: 7, day: 10 }])(
      'should return undefined for %j',
      function (value) {
        expect(toUtcDate(value)).toBeUndefined();
      }
    );
  });
});
