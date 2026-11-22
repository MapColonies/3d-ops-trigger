export interface BoundingVolume {
  sphere?: number[];
  region?: number[];
  box?: number[];
}

export interface BoundingSphere {
  sphere: number[];
}

export interface BoundingRegion {
  region: number[];
}

export interface TileSetJson {
  root: {
    boundingVolume: BoundingVolume;
  };
}
