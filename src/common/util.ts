export const is3tz = (modelPath: string): boolean => modelPath.toLowerCase().endsWith('.3tz');

export const buildModelFilePath = (modelPath: string, tilesetFilename: string): string =>
  is3tz(modelPath) ? modelPath : `${modelPath}/${tilesetFilename}`;
