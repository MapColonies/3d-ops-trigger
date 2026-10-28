import { basename } from 'node:path';
import type { Feature } from 'geojson';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { openShapefile, type IShapefileSource, type ShapefileReadResult } from '@map-colonies/shapefile-reader';
import { inject, injectable } from 'tsyringe';
import { AppError, extractShapeMetadataRow, type LogContext, type ShapeMetadataRow } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import type { IngestionFiles, ShapefileFiles } from '../validator/interfaces';
import { ERROR_METADATA_NO_ATTRIBUTES, ERROR_METADATA_NO_FEATURES } from './constants';

@injectable()
export class MetadataExtractor {
  private readonly logContext: LogContext;

  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {
    this.logContext = {
      fileName: __filename,
      class: MetadataExtractor.name,
    };
  }

  public async extract(files: IngestionFiles): Promise<ShapeMetadataRow> {
    const logContext = { ...this.logContext, function: this.extract.name };
    this.logger.info({ msg: 'extracting metadata from shapefile first row', logContext, shapefile: files.metadata.shp });

    const firstFeature = await this.readFirstFeature(files.metadata);
    if (firstFeature.properties === null) {
      this.logger.error({ msg: ERROR_METADATA_NO_ATTRIBUTES, logContext, shapefile: files.metadata.shp });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_NO_ATTRIBUTES, true);
    }

    const result = extractShapeMetadataRow(firstFeature.properties);
    if (!result.success) {
      this.logger.warn({ msg: 'shapefile metadata is invalid', logContext, errors: result.errors });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, result.errors.join('; '), true);
    }

    this.logger.info({ msg: 'metadata extracted successfully', logContext });
    return result.data;
  }

  private async readFirstFeature(files: ShapefileFiles): Promise<Feature> {
    const logContext = { ...this.logContext, function: this.readFirstFeature.name };
    let source: IShapefileSource | undefined;
    let result: ShapefileReadResult;
    try {
      source = await openShapefile(files.shp);
      result = await source.read();
    } catch (err) {
      this.logger.error({ msg: 'failed to read shapefile', logContext, err, shapefile: files.shp });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, `${basename(files.shp)}: shapefile is corrupted or unreadable`, true);
    } finally {
      source?.close();
    }

    if (result.done) {
      this.logger.error({ msg: ERROR_METADATA_NO_FEATURES, logContext, shapefile: files.shp });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_NO_FEATURES, true);
    }
    return result.value;
  }
}
