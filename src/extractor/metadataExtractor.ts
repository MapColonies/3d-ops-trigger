import { basename } from 'node:path';
import type { Feature } from 'geojson';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { openShapefile } from '@map-colonies/shapefile-reader';
import { inject, injectable } from 'tsyringe';
import { AppError, type LogContext } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import type { IngestionFiles, ShapefileFiles } from '../validator/interfaces';
import { ERROR_METADATA_NO_FEATURES } from './constants';
import { extractCommonMetadata } from './shapefileMetadata';
import type { ExtractedMetadata } from './interfaces';

@injectable()
export class MetadataExtractor {
  private readonly logContext: LogContext;

  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {
    this.logContext = {
      fileName: __filename,
      class: MetadataExtractor.name,
    };
  }

  public async extract(files: IngestionFiles): Promise<ExtractedMetadata> {
    const logContext = { ...this.logContext, function: this.extract.name };
    this.logger.info({ msg: 'extracting common metadata from the first shapefile row', logContext, shapefile: files.metadata.shp });

    const firstFeature = await this.readFirstFeature(files.metadata);

    const result = extractCommonMetadata(firstFeature);
    if (!result.success) {
      this.logger.warn({ msg: 'shapefile metadata is invalid', logContext, errors: result.errors });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, result.errors.join('; '), true);
    }

    this.logger.info({ msg: 'extracted common metadata from the shapefile', logContext });
    return result.data;
  }

  private async readFirstFeature(files: ShapefileFiles): Promise<Feature> {
    const logContext = { ...this.logContext, function: this.readFirstFeature.name };
    let source: Awaited<ReturnType<typeof openShapefile>> | undefined;
    try {
      source = await openShapefile(files.shp);
      const { done, value } = await source.read();
      if (done) {
        throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_NO_FEATURES, true);
      }
      return value;
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      this.logger.error({ msg: 'failed to read shapefile', logContext, err, shapefile: files.shp });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, `${basename(files.shp)}: shapefile is corrupted or unreadable`, true);
    } finally {
      source?.close();
    }
  }
}
