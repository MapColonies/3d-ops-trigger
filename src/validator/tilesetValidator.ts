import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { calculatePolygonFromTileset, type TileSetJson } from '@map-colonies/3d-shared';
import { area, feature, featureCollection, intersect, union } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { SERVICES } from '@common/constants';
import type { IngestionPayload, LogContext, ValidationResponse } from '@common/interfaces';
import { AppError } from '@common/appError';
import type { ConfigType } from '@common/config';
import { TilesetReader } from '../tileset/tilesetReader';
import { ERROR_FOOTPRINT_FAR_FROM_MODEL, ERROR_INTERSECTION_FAILED, ERROR_TILESET_INVALID } from './errors';

const FULL_COVERAGE_PERCENT = 100;

@injectable()
export class TilesetValidator {
  private readonly logContext: LogContext;
  private readonly percentageLimit: number;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(TilesetReader) private readonly tilesetReader: TilesetReader
  ) {
    this.percentageLimit = this.config.get('validation.percentageLimit');
    this.logContext = {
      fileName: __filename,
      class: TilesetValidator.name,
    };
  }

  public async validateTileset(payload: IngestionPayload, footprint: Polygon | MultiPolygon): Promise<void> {
    const content = await this.tilesetReader.readTilesetJson(payload.modelPath, payload.tilesetFilename);

    const { modelPolygon, response: polygonResponse } = this.getTilesetModelPolygon(content);
    if (!polygonResponse.isValid || modelPolygon === undefined) {
      this.rejectValidation(polygonResponse);
    }

    const intersectionResponse = this.isFootprintAndModelIntersects(footprint, modelPolygon);
    if (!intersectionResponse.isValid) {
      this.rejectValidation(intersectionResponse);
    }
  }

  private getTilesetModelPolygon(content: string): { modelPolygon?: Polygon; response: ValidationResponse } {
    const logContext = { ...this.logContext, function: this.getTilesetModelPolygon.name };
    try {
      const tilesetJson = JSON.parse(content) as TileSetJson;
      const modelPolygon = calculatePolygonFromTileset(tilesetJson);
      this.logger.debug({ msg: 'extracted tileset model polygon', logContext, modelPolygon });

      return { modelPolygon, response: { isValid: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : ERROR_TILESET_INVALID;
      this.logger.error({ msg: 'tileset polygon extraction failed', logContext, err });
      return { response: { isValid: false, message } };
    }
  }

  private isFootprintAndModelIntersects(footprint: Polygon | MultiPolygon, modelPolygon: Polygon): ValidationResponse {
    const logContext = { ...this.logContext, function: this.isFootprintAndModelIntersects.name };
    try {
      const footprintFeature = feature(footprint);
      const modelFeature: Feature<Polygon> = feature(modelPolygon);

      const intersection = intersect(featureCollection([footprintFeature, modelFeature]));
      if (intersection === null) {
        return { isValid: false, message: ERROR_FOOTPRINT_FAR_FROM_MODEL };
      }

      const combined = union(featureCollection([footprintFeature, modelFeature]));
      const combinedArea = combined === null ? 0 : area(combined);
      const coverage = combinedArea === 0 ? 0 : (FULL_COVERAGE_PERCENT * area(footprintFeature)) / combinedArea;
      this.logger.debug({ msg: 'calculated footprint coverage of the model', logContext, coverage, percentageLimit: this.percentageLimit });

      if (coverage < this.percentageLimit) {
        return {
          isValid: false,
          message: `The footprint intersectection with the model doesn't reach minimum required threshhold, the coverage is: ${coverage}% when the minimum coverage is ${this.percentageLimit}%`,
        };
      }
      return { isValid: true };
    } catch (err) {
      this.logger.error({ msg: ERROR_INTERSECTION_FAILED, logContext, err });
      return { isValid: false, message: ERROR_INTERSECTION_FAILED };
    }
  }

  private rejectValidation(response: ValidationResponse): never {
    const logContext = { ...this.logContext, function: this.rejectValidation.name };
    const message = response.message ?? ERROR_TILESET_INVALID;
    this.logger.warn({ msg: 'ingestion validation failed', logContext, isValid: response.isValid, message });

    throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
  }
}
