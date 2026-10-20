import { basename } from 'node:path';
import type { Feature } from 'geojson';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { openShapefile, type IShapefileSource, type ShapefileReadResult } from '@map-colonies/shapefile-reader';
import { inject, injectable } from 'tsyringe';
import { AppError, extractShapeMetadataRow, type LogContext, type ShapeMetadataRow } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import type { IngestionFiles, ShapefileFiles } from '../validator/interfaces';
import { ERROR_METADATA_NO_FEATURES } from './constants';

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
    this.logger.info({ msg: 'extracting the metadata from the first shapefile row', logContext, shapefile: files.metadata.shp });

    const firstFeature = await this.readFirstFeature(files.metadata);

    const result = extractShapeMetadataRow(firstFeature.properties ?? {});
    if (!result.success) {
      this.logger.warn({ msg: 'shapefile metadata is invalid', logContext, errors: result.errors });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, result.errors.join('; '), true);
    }

    this.logger.info({ msg: 'extracted the metadata from the shapefile', logContext });
    return result.data;
  }

  private async readFirstFeature(files: ShapefileFiles): Promise<Feature> {
    const result = await this.readFirstRow(files);
    if (result.done) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_NO_FEATURES, true);
    }
    return result.value;
  }

  private async readFirstRow(files: ShapefileFiles): Promise<ShapefileReadResult> {
    const logContext = { ...this.logContext, function: this.readFirstRow.name };
    let source: IShapefileSource | undefined;
    try {
      source = await openShapefile(files.shp);
      return await source.read();
    } catch (err) {
      this.logger.error({ msg: 'failed to read shapefile', logContext, err, shapefile: files.shp });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, `${basename(files.shp)}: shapefile is corrupted or unreadable`, true);
    } finally {
      source?.close();
    }
  }
}
