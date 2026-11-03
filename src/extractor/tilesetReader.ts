import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Polygon } from 'geojson';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { TilesetError, TilesetSources, type TilesetSource } from '3d-tiles-tools';
import {
  AppError,
  calculatePolygonFromTileset,
  ERROR_BAD_FORMAT_TILESET,
  ERROR_BOX_TILESET,
  type LogContext,
  type TileSetJson,
} from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import { ERROR_3TZ_INVALID, ERROR_3TZ_INVALID_PREFIX, ERROR_TILESET_INVALID, ERROR_TILESET_NOT_IN_ARCHIVE, TILESET_FILENAME } from './constants';

@injectable()
export class TilesetReader {
  private readonly logContext: LogContext;

  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {
    this.logContext = {
      fileName: __filename,
      class: TilesetReader.name,
    };
  }

  public async readModelPolygon(modelPath: string): Promise<Polygon> {
    const logContext = { ...this.logContext, function: this.readModelPolygon.name };
    this.logger.info({ msg: 'reading model polygon from tileset', logContext, modelPath });

    const content = extname(modelPath).toLowerCase() === '.3tz' ? await this.readFromArchive(modelPath) : await this.readFromFile(modelPath);
    const tileset = this.parseTileset(content, modelPath);

    try {
      const modelPolygon = calculatePolygonFromTileset(tileset);
      this.logger.info({ msg: 'model polygon extracted successfully', logContext, modelPath });
      return modelPolygon;
    } catch (err) {
      const isKnownError = err instanceof Error && [ERROR_BOX_TILESET, ERROR_BAD_FORMAT_TILESET].includes(err.message);
      this.reject(logContext, isKnownError ? err.message : ERROR_TILESET_INVALID, { modelPath, err });
    }
  }

  private async readFromFile(modelPath: string): Promise<string> {
    const logContext = { ...this.logContext, function: this.readFromFile.name };
    try {
      return await readFile(modelPath, 'utf-8');
    } catch (err) {
      this.reject(logContext, `${basename(modelPath)}: tileset is unreadable`, { modelPath, err });
    }
  }

  private async readFromArchive(archivePath: string): Promise<string> {
    const logContext = { ...this.logContext, function: this.readFromArchive.name };
    let source: TilesetSource | undefined;
    try {
      source = await TilesetSources.createAndOpen(archivePath);
      const content = await source.getValue(TILESET_FILENAME);
      if (content === undefined) {
        return this.reject(logContext, ERROR_TILESET_NOT_IN_ARCHIVE, { archivePath });
      }
      return content.toString('utf-8');
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const message = err instanceof TilesetError ? `${ERROR_3TZ_INVALID_PREFIX}: ${err.message}` : ERROR_3TZ_INVALID;
      return this.reject(logContext, message, { archivePath, err });
    } finally {
      await source?.close();
    }
  }

  private parseTileset(content: string, modelPath: string): TileSetJson {
    const logContext = { ...this.logContext, function: this.parseTileset.name };
    let tileset: unknown;
    try {
      tileset = JSON.parse(content);
    } catch (err) {
      this.reject(logContext, ERROR_TILESET_INVALID, { modelPath, err });
    }

    const { asset, root } = (tileset ?? {}) as { asset?: unknown; root?: { boundingVolume?: unknown } | null };
    if (
      typeof asset !== 'object' ||
      asset === null ||
      typeof root !== 'object' ||
      root === null ||
      typeof root.boundingVolume !== 'object' ||
      root.boundingVolume === null
    ) {
      this.reject(logContext, ERROR_TILESET_INVALID, { modelPath });
    }
    return tileset as TileSetJson;
  }

  private reject(logContext: LogContext, message: string, details: Record<string, unknown>): never {
    this.logger.error({ msg: message, logContext, ...details });
    throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
  }
}
