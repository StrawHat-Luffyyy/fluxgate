export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    isOperational = true,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, code = "BAD_REQUEST"): AppError {
    return new AppError(message, 400, code);
  }

  static unauthorized(message: string, code = "UNAUTHORIZED"): AppError {
    return new AppError(message, 401, code);
  }

  static forbidden(message: string, code = "FORBIDDEN"): AppError {
    return new AppError(message, 403, code);
  }

  static notFound(message: string, code = "NOT_FOUND"): AppError {
    return new AppError(message, 404, code);
  }

  static conflict(message: string, code = "CONFLICT"): AppError {
    return new AppError(message, 409, code);
  }

  static tooManyRequests(message: string, code = "TOO_MANY_REQUESTS"): AppError {
    return new AppError(message, 429, code);
  }

  static serviceUnavailable(message: string, code = "SERVICE_UNAVAILABLE"): AppError {
    return new AppError(message, 503, code);
  }

  static internal(message: string, code = "INTERNAL_ERROR"): AppError {
    return new AppError(message, 500, code, false);
  }
}
