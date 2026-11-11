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
import {
  ARCHIVE_EXTENSION,
  ERROR_3TZ_INVALID,
  ERROR_3TZ_INVALID_PREFIX,
  ERROR_TILESET_ASSET_VERSION,
  ERROR_TILESET_INVALID,
  ERROR_TILESET_NOT_IN_ARCHIVE,
  MIN_ASSET_MAJOR_VERSION,
  TILESET_FILENAME,
} from './constants';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

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

    let content: string;
    if (extname(modelPath).toLowerCase() === ARCHIVE_EXTENSION) {
      content = await this.readFromArchive(modelPath);
    } else {
      content = await this.readFromFile(modelPath);
    }
    const tileset = this.parseTileset(content, modelPath);

    try {
      const modelPolygon = calculatePolygonFromTileset(tileset);
      this.logger.info({ msg: 'model polygon extracted successfully', logContext, modelPath });
      return modelPolygon;
    } catch (err) {
      const isKnownError = err instanceof Error && [ERROR_BOX_TILESET, ERROR_BAD_FORMAT_TILESET].includes(err.message);
      const message = isKnownError ? err.message : `${ERROR_TILESET_INVALID}: could not calculate the model polygon from root.boundingVolume`;
      this.reject(logContext, message, { modelPath, err });
    }
  }

  private async readFromFile(modelPath: string): Promise<string> {
    const logContext = { ...this.logContext, function: this.readFromFile.name };
    this.logger.info({ msg: `reading tileset from file ${modelPath}`, logContext, modelPath });
    try {
      return await readFile(modelPath, 'utf-8');
    } catch (err) {
      this.reject(logContext, `${basename(modelPath)}: tileset is unreadable`, { modelPath, err });
    }
  }

  private async readFromArchive(archivePath: string): Promise<string> {
    const logContext = { ...this.logContext, function: this.readFromArchive.name };
    this.logger.info({ msg: `reading tileset from archive ${archivePath}`, logContext, archivePath });
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
      this.reject(logContext, `${ERROR_TILESET_INVALID}: the file is not valid JSON`, { modelPath, err });
    }

    const structureProblem = this.findStructureProblem(tileset);
    if (structureProblem !== undefined) {
      this.reject(logContext, `${ERROR_TILESET_INVALID}: ${structureProblem}`, { modelPath });
    }

    const { version } = (tileset as { asset: { version?: unknown } }).asset;
    if (!this.isSupportedVersion(version)) {
      this.reject(logContext, `${ERROR_TILESET_ASSET_VERSION}, received: ${this.describeVersion(version)}`, { modelPath, version });
    }
    return tileset as TileSetJson;
  }

  private findStructureProblem(tileset: unknown): string | undefined {
    if (!isObject(tileset)) {
      return 'the file content must be a JSON object';
    }
    for (const [property, value] of [
      ['asset', tileset.asset],
      ['root', tileset.root],
      ['root.boundingVolume', isObject(tileset.root) ? tileset.root.boundingVolume : undefined],
    ] as const) {
      if (!isObject(value)) {
        return `"${property}" is missing or is not an object`;
      }
    }
    return undefined;
  }

  private describeVersion(version: unknown): string {
    if (version === undefined) {
      return 'none';
    }
    return typeof version === 'string' ? `"${version}"` : `${JSON.stringify(version)} (a ${typeof version}, expected a string)`;
  }

  private isSupportedVersion(version: unknown): boolean {
    if (typeof version !== 'string') {
      return false;
    }
    const match = /^(\d+)(\.\d+)+$/.exec(version);
    return match !== null && Number(match[1]) >= MIN_ASSET_MAJOR_VERSION;
  }

  private reject(logContext: LogContext, message: string, details: Record<string, unknown>): never {
    this.logger.error({ msg: message, logContext, ...details });
    throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
  }
}
