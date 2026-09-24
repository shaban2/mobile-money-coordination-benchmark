export class DomainError extends Error {
  constructor(code, message, httpStatus = 400, details = undefined) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function asErrorBody(error) {
  if (error instanceof DomainError || (error?.code && error?.httpStatus)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {})
      }
    };
  }

  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The request could not be completed.'
    }
  };
}
