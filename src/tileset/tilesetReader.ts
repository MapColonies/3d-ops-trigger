import { readFile, open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { SERVICES } from '@common/constants';
import { AppError } from '@common/appError';
import { is3tz, buildModelFilePath } from '@common/util';
import type { LogContext } from '@common/interfaces';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const GENERAL_PURPOSE_FLAG_OFFSET = 6;
const COMPRESSION_METHOD_OFFSET = 8;
const COMPRESSED_SIZE_OFFSET = 18;
const NAME_LENGTH_OFFSET = 26;
const EXTRA_LENGTH_OFFSET = 28;
const HEADER_FIXED_LENGTH = 30;
const COMPRESSION_STORED = 0;
const COMPRESSION_DEFLATED = 8;
const DATA_DESCRIPTOR_FLAG = 0x08;
const ZIP64_SIZE_SENTINEL = 0xffffffff;

export const ERROR_TILESET_NOT_FIRST_ENTRY = 'tileset file is not the first entry of the 3tz archive';
export const ERROR_TILESET_UNSUPPORTED_COMPRESSION = 'tileset entry uses an unsupported compression method';
export const ERROR_TILESET_UNSUPPORTED_ENCODING = 'tileset entry size is not available in the local header (data descriptor or ZIP64)';
export const ERROR_TILESET_READ_FAILED = 'failed reading the tileset file';

@injectable()
export class TilesetReader {
  private readonly logContext: LogContext;

  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {
    this.logContext = {
      fileName: __filename,
      class: TilesetReader.name,
    };
  }

  public async readTilesetJson(modelPath: string, tilesetFilename: string): Promise<string> {
    return is3tz(modelPath) ? this.readFromArchive(modelPath, tilesetFilename) : this.readFromFolder(modelPath, tilesetFilename);
  }

  private async readFromFolder(modelPath: string, tilesetFilename: string): Promise<string> {
    const logContext = { ...this.logContext, function: this.readFromFolder.name };
    const path = buildModelFilePath(modelPath, tilesetFilename);
    try {
      return await readFile(path, 'utf-8');
    } catch (err) {
      this.logger.error({ msg: 'failed reading tileset from folder', logContext, path, err });
      throw new AppError('tileset', StatusCodes.INTERNAL_SERVER_ERROR, ERROR_TILESET_READ_FAILED, false);
    }
  }

  private async readFromArchive(archivePath: string, tilesetFilename: string): Promise<string> {
    const logContext = { ...this.logContext, function: this.readFromArchive.name };
    let handle;
    try {
      handle = await open(archivePath, 'r');
    } catch (err) {
      this.logger.error({ msg: 'failed opening 3tz archive', logContext, archivePath, err });
      throw new AppError('tileset', StatusCodes.INTERNAL_SERVER_ERROR, ERROR_TILESET_READ_FAILED, false);
    }

    try {
      const header = Buffer.alloc(HEADER_FIXED_LENGTH);
      await handle.read(header, 0, HEADER_FIXED_LENGTH, 0);

      if (header.readUInt32LE(0) !== LOCAL_FILE_HEADER_SIGNATURE) {
        throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_TILESET_NOT_FIRST_ENTRY, true);
      }

      const flags = header.readUInt16LE(GENERAL_PURPOSE_FLAG_OFFSET);
      const method = header.readUInt16LE(COMPRESSION_METHOD_OFFSET);
      const compressedSize = header.readUInt32LE(COMPRESSED_SIZE_OFFSET);
      const nameLength = header.readUInt16LE(NAME_LENGTH_OFFSET);
      const extraLength = header.readUInt16LE(EXTRA_LENGTH_OFFSET);

      if ((flags & DATA_DESCRIPTOR_FLAG) !== 0 || compressedSize === 0 || compressedSize === ZIP64_SIZE_SENTINEL) {
        throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_TILESET_UNSUPPORTED_ENCODING, true);
      }

      const nameBuffer = Buffer.alloc(nameLength);
      await handle.read(nameBuffer, 0, nameLength, HEADER_FIXED_LENGTH);
      if (nameBuffer.toString('utf-8') !== tilesetFilename) {
        this.logger.error({
          msg: 'first 3tz entry is not the expected tileset file',
          logContext,
          entryName: nameBuffer.toString('utf-8'),
          tilesetFilename,
        });
        throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_TILESET_NOT_FIRST_ENTRY, true);
      }

      const raw = Buffer.alloc(compressedSize);
      await handle.read(raw, 0, compressedSize, HEADER_FIXED_LENGTH + nameLength + extraLength);

      if (method === COMPRESSION_STORED) {
        return raw.toString('utf-8');
      }
      if (method === COMPRESSION_DEFLATED) {
        return inflateRawSync(raw).toString('utf-8');
      }
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_TILESET_UNSUPPORTED_COMPRESSION, true);
    } finally {
      await handle.close();
    }
  }
}
