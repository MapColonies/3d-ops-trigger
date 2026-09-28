import type { StatusCodes } from 'http-status-codes';

export class AppError extends Error {
  public override readonly name: string;
  public readonly status: StatusCodes;
  public readonly isOperational: boolean;

  public constructor(name: string, status: StatusCodes, description: string, isOperational: boolean) {
    super(description);

    Object.setPrototypeOf(this, new.target.prototype);

    this.name = name;
    this.status = status;
    this.isOperational = isOperational;
    this.message = description;

    Error.captureStackTrace(this);
  }
}
