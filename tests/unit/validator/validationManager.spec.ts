import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppError } from '@map-colonies/3d-shared';
import { ValidationManager } from '@src/validator/validationManager';
import type { LookupTablesClient } from '@src/externalServices/lookupTables/lookupTablesClient';

const validPayload = { classification: 'abc123', region: ['ישראל'] };

describe('ValidationManager', function () {
  let validator: ValidationManager;
  let lookupTablesClient: { getClassifications: ReturnType<typeof vi.fn>; getCountries: ReturnType<typeof vi.fn> };

  beforeEach(async function () {
    lookupTablesClient = {
      getClassifications: vi.fn().mockResolvedValue(['abc123']),
      getCountries: vi.fn().mockResolvedValue(['ישראל', 'USA']),
    };
    validator = new ValidationManager(await jsLogger({ enabled: false }), lookupTablesClient as unknown as LookupTablesClient);
  });

  it('should pass when the classification and region are in the lookup tables', async function () {
    await expect(validator.validateIngestion(validPayload)).resolves.toBeUndefined();
    expect(lookupTablesClient.getClassifications).toHaveBeenCalled();
    expect(lookupTablesClient.getCountries).toHaveBeenCalled();
  });

  it('should throw 400 when the classification is not in the lookup table', async function () {
    const promise = validator.validateIngestion({ ...validPayload, classification: 'notInLookup' });

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow('classification is not a valid value. Optional values: abc123');
  });

  it('should throw 400 listing the regions that are not in the countries lookup table', async function () {
    await expect(validator.validateIngestion({ ...validPayload, region: ['ישראל', 'Atlantis', 'Mordor'] })).rejects.toThrow(
      'region contains invalid values: Atlantis,Mordor'
    );
  });

  it('should not check the region when the classification is invalid', async function () {
    await expect(validator.validateIngestion({ ...validPayload, classification: 'notInLookup' })).rejects.toThrow(AppError);
    expect(lookupTablesClient.getCountries).not.toHaveBeenCalled();
  });
});
