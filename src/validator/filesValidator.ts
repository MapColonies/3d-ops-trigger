import { open, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { AppError, type LogContext } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import type { IngestionPayload } from '../record/models/recordManager';
import type { IngestionFiles, ShapefileFiles } from './interfaces';

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_SIGNATURE_LENGTH = 4;
const VALID_CPG_ENCODINGS = ['UTF-8', 'UTF8'];
const WGS84_PATTERN = /WGS[\s_]?(19)?84/i;

export const DATA_FOLDER = 'data';
export const SHAPE_FOLDER = 'shape';
export const SHAPEFILE_SIDECAR_EXTENSIONS = ['.shp', '.shx', '.dbf', '.prj', '.cpg'] as const;

export const ERROR_PATH_OUTSIDE_BASE = 'path must be inside the storage base path';
export const ERROR_MODEL_FORMAT = 'modelPath must point to a tileset.json (.json) or a .3tz file';
export const ERROR_MODEL_NOT_IN_DATA = `modelPath must be inside the "${DATA_FOLDER}" folder, next to the "${SHAPE_FOLDER}" folder`;
export const ERROR_SHAPEFILE_FORMAT = 'shapefile paths must point to a .shp file';
export const ERROR_SHAPEFILE_NOT_IN_SHAPE = `shapefiles must be inside the "${SHAPE_FOLDER}" folder`;
export const ERROR_SHAPEFILES_DIFFERENT_FOLDERS = `productShapefilePath and metadataShapefilePath must be in the same "${SHAPE_FOLDER}" folder`;
export const ERROR_PRJ_NOT_WGS84 = 'projection (.prj) must be Geographic WGS84 (EPSG:4326)';
export const ERROR_CPG_NOT_UTF8 = 'encoding (.cpg) must be UTF-8';
export const ERROR_TILESET_INVALID = 'tileset json is not a valid 3D Tiles tileset (missing asset/root)';
export const ERROR_3TZ_INVALID = '.3tz file is not a valid zip archive';

@injectable()
export class FilesValidator {
  private readonly logContext: LogContext;
  private readonly basePath: string;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.basePath = resolve(this.config.get('storage.basePath'));
    this.logContext = {
      fileName: __filename,
      class: FilesValidator.name,
    };
  }

  public async validateIngestionFiles(
    payload: Pick<IngestionPayload, 'modelPath' | 'productShapefilePath' | 'metadataShapefilePath'>
  ): Promise<IngestionFiles> {
    const logContext = { ...this.logContext, function: this.validateIngestionFiles.name };
    this.logger.info({ msg: 'ingestion files validation start', logContext, modelPath: payload.modelPath });

    const modelPath = this.resolveInBase(payload.modelPath, 'modelPath');
    const productShapefilePath = this.resolveInBase(payload.productShapefilePath, 'productShapefilePath');
    const metadataShapefilePath = this.resolveInBase(payload.metadataShapefilePath, 'metadataShapefilePath');

    this.validateLayout(modelPath, productShapefilePath, metadataShapefilePath);

    const product = this.toShapefileFiles(productShapefilePath);
    const metadata = this.toShapefileFiles(metadataShapefilePath);
    await this.validateExistence([modelPath, ...this.shapefilePaths(product), ...this.shapefilePaths(metadata)]);

    await this.validateModelFormat(modelPath);
    await this.validateShapefileFormat(product);
    await this.validateShapefileFormat(metadata);

    this.logger.info({ msg: 'ingestion files are valid', logContext, modelPath: payload.modelPath });
    return { modelPath, product, metadata };
  }

  private resolveInBase(relativePath: string, field: string): string {
    const absolutePath = resolve(join(this.basePath, relativePath));
    if (!absolutePath.startsWith(this.basePath + sep)) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, `${field}: ${ERROR_PATH_OUTSIDE_BASE}`, true);
    }
    return absolutePath;
  }

  private validateLayout(modelPath: string, productShapefilePath: string, metadataShapefilePath: string): void {
    const modelExtension = extname(modelPath).toLowerCase();
    if (modelExtension !== '.json' && modelExtension !== '.3tz') {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_MODEL_FORMAT, true);
    }

    for (const shapefilePath of [productShapefilePath, metadataShapefilePath]) {
      if (extname(shapefilePath).toLowerCase() !== '.shp') {
        throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_SHAPEFILE_FORMAT, true);
      }
      if (basename(dirname(shapefilePath)) !== SHAPE_FOLDER) {
        throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_SHAPEFILE_NOT_IN_SHAPE, true);
      }
    }

    const shapeFolder = dirname(productShapefilePath);
    if (dirname(metadataShapefilePath) !== shapeFolder) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_SHAPEFILES_DIFFERENT_FOLDERS, true);
    }

    const dataFolder = join(dirname(shapeFolder), DATA_FOLDER);
    if (!modelPath.startsWith(dataFolder + sep)) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_MODEL_NOT_IN_DATA, true);
    }
  }

  private toShapefileFiles(shpPath: string): ShapefileFiles {
    const base = shpPath.slice(0, -extname(shpPath).length);
    const [shp, shx, dbf, prj, cpg] = SHAPEFILE_SIDECAR_EXTENSIONS.map((extension) => `${base}${extension}`) as [
      string,
      string,
      string,
      string,
      string,
    ];
    return { shp, shx, dbf, prj, cpg };
  }

  private shapefilePaths(files: ShapefileFiles): string[] {
    return [files.shp, files.shx, files.dbf, files.prj, files.cpg];
  }

  private async validateExistence(paths: string[]): Promise<void> {
    const results = await Promise.all(paths.map(async (path) => ({ path, exists: await this.isFile(path) })));
    const missing = results.filter((result) => !result.exists).map((result) => result.path.slice(this.basePath.length + 1));
    if (missing.length > 0) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, `missing files: ${missing.join(', ')}`, true);
    }
  }

  private async isFile(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  private async validateModelFormat(modelPath: string): Promise<void> {
    if (extname(modelPath).toLowerCase() === '.3tz') {
      await this.validate3tz(modelPath);
      return;
    }

    let tileset: unknown;
    try {
      tileset = JSON.parse(await readFile(modelPath, 'utf-8'));
    } catch {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_TILESET_INVALID, true);
    }

    const { asset, root } = (tileset ?? {}) as { asset?: unknown; root?: unknown };
    if (typeof asset !== 'object' || asset === null || typeof root !== 'object' || root === null) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_TILESET_INVALID, true);
    }
  }

  private async validate3tz(modelPath: string): Promise<void> {
    const handle = await open(modelPath, 'r');
    try {
      const buffer = Buffer.alloc(ZIP_SIGNATURE_LENGTH);
      const { bytesRead } = await handle.read(buffer, 0, ZIP_SIGNATURE_LENGTH, 0);
      if (bytesRead < ZIP_SIGNATURE_LENGTH || buffer.readUInt32LE(0) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
        throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_3TZ_INVALID, true);
      }
    } finally {
      await handle.close();
    }
  }

  private async validateShapefileFormat(files: ShapefileFiles): Promise<void> {
    const prj = (await readFile(files.prj, 'utf-8')).trim();
    if (!prj.startsWith('GEOGCS') || !WGS84_PATTERN.test(prj)) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, `${basename(files.prj)}: ${ERROR_PRJ_NOT_WGS84}`, true);
    }

    const cpg = (await readFile(files.cpg, 'utf-8')).trim().toUpperCase();
    if (!VALID_CPG_ENCODINGS.includes(cpg)) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, `${basename(files.cpg)}: ${ERROR_CPG_NOT_UTF8}`, true);
    }
  }
}
