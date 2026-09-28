export interface Record3D {
  id: string;
  productId?: string;
  productName?: string;
  productVersion?: number;
  productStatus?: string;
  links?: string;
}

export interface IFindRecordsPayload {
  id?: string;
  productId?: string;
  productName?: string;
  productType?: string;
  classification?: string;
  productStatus?: string;
}
