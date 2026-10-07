import { basename } from 'node:path';
import type { FeatureCollection } from 'geojson';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { read } from 'shapefile';
import { inject, injectable } from 'tsyringe';
import { AppError, type LogContext } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import type { IngestionFiles, ShapefileFiles } from '../validator/interfaces';
import { extractMetadata } from './shapefileMetadata';
import type { ExtractedMetadata } from './interfaces';

const SHAPEFILE_ENCODING = 'utf-8';

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
    this.logger.info({ msg: 'extracting metadata from shapefiles', logContext, shapefile: files.metadata.shp });

    const [product, shapeMetadata] = await Promise.all([this.readShapefile(files.product), this.readShapefile(files.metadata)]);

    const result = extractMetadata(product, shapeMetadata);
    if (!result.success) {
      this.logger.warn({ msg: 'shapefile metadata is invalid', logContext, errors: result.errors });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, result.errors.join('; '), true);
    }

    this.logger.info({ msg: 'extracted metadata from shapefiles', logContext, parts: shapeMetadata.features.length });
    return result.data;
  }

  private async readShapefile(files: ShapefileFiles): Promise<FeatureCollection> {
    const logContext = { ...this.logContext, function: this.readShapefile.name };
    try {
      return await read(files.shp, files.dbf, { encoding: SHAPEFILE_ENCODING });
    } catch (err) {
      this.logger.error({ msg: 'failed to read shapefile', logContext, err, shapefile: files.shp });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, `${basename(files.shp)}: shapefile is corrupted or unreadable`, true);
    }
  }
}
