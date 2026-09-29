export interface Provider {
  fileExists: (relativePath: string) => Promise<boolean>;
}
