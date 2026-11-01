import { basename } from 'node:path';
import type { Logger } from '@map-colonies/js-logger';
import { ShapefileChunkReader, type ChunkProcessor, type ShapefileChunk } from '@map-colonies/shapefile-reader';
import { StatusCodes } from 'http-status-codes';
import type { Feature } from 'geojson';
import { inject, injectable } from 'tsyringe';
import { AppError, geometrySchema, type LogContext } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import { ERROR_PRODUCT_GEOMETRY, ERROR_PRODUCT_SINGLE_FEATURE, SHAPEFILE_NO_FEATURES_MESSAGE } from './constants';
import type { ProductFootprint } from './interfaces';

@injectable()
export class ProductReader {
  private readonly logContext: LogContext;
  private readonly reader: ShapefileChunkReader;

  public constructor(
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.logContext = {
      fileName: __filename,
      class: ProductReader.name,
    };
    this.reader = new ShapefileChunkReader({
      maxVerticesPerChunk: config.get('productReader.maxVerticesPerChunk'),
      generateFeatureId: true,
      logger: this.logger,
    });
  }

  public async read(productShapefilePath: string): Promise<ProductFootprint> {
    const logContext = { ...this.logContext, function: this.read.name };
    this.logger.info({ msg: 'reading product shapefile', logContext, productShapefilePath });

    const { count, firstFeature } = await this.readAndProcess(productShapefilePath);
    if (count !== 1 || firstFeature === undefined) {
      this.logger.error({ msg: ERROR_PRODUCT_SINGLE_FEATURE, logContext, productShapefilePath, features: count });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, `Product shapefile is not valid: ${ERROR_PRODUCT_SINGLE_FEATURE}`, true);
    }

    const geometry = geometrySchema.safeParse(firstFeature.geometry);
    if (!geometry.success) {
      this.logger.error({ msg: ERROR_PRODUCT_GEOMETRY, logContext, productShapefilePath, issues: geometry.error.issues });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, `Product shapefile is not valid: ${ERROR_PRODUCT_GEOMETRY}`, true);
    }

    return geometry.data;
  }

  private async readAndProcess(productShapefilePath: string): Promise<{ count: number; firstFeature: Feature | undefined }> {
    const logContext = { ...this.logContext, function: this.readAndProcess.name };
    let count = 0;
    let firstFeature: Feature | undefined;
    const processor: ChunkProcessor = {
      process: async (chunk: ShapefileChunk): Promise<void> => {
        count += chunk.features.length + chunk.skippedFeatures.length;
        firstFeature ??= chunk.features[0] ?? chunk.skippedFeatures[0];
        await Promise.resolve();
      },
    };

    try {
      await this.reader.readAndProcess(productShapefilePath, processor);
    } catch (err) {
      this.logger.error({ msg: 'failed to read product shapefile', logContext, err, productShapefilePath });
      throw this.toReadError(err, productShapefilePath);
    }
    return { count, firstFeature };
  }

  private toReadError(err: unknown, productShapefilePath: string): AppError {
    const file = basename(productShapefilePath);
    const message =
      err instanceof Error && err.message.endsWith(SHAPEFILE_NO_FEATURES_MESSAGE)
        ? `Product shapefile is not valid: ${file} ${SHAPEFILE_NO_FEATURES_MESSAGE}`
        : `Failed to read product shapefile: ${file} shapefile is corrupted or unreadable`;
    return new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
  }
}
