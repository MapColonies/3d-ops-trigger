export enum LookupKey {
  CLASSIFICATION = 'classification',
  COUNTRIES = 'countries',
}

export interface ILookupOption {
  value: string;
  translationCode: string;
  properties?: Record<string, unknown>;
}
