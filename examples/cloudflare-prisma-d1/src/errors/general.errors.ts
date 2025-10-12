import { ServiceError } from "@getcronit/pylon";

export class InvalidInputError extends ServiceError {
  constructor(message: string) {
    super(message, {
      code: "INVALID_INPUT",
      statusCode: 400,
    });
  }
}

export class NotFoundError extends ServiceError {
  constructor(message: string) {
    super(message, {
      code: "NOT_FOUND",
      statusCode: 404,
    });
  }
}

export class AuthorizationError extends ServiceError {
  constructor(message: string) {
    super(message, {
      code: "AUTHORIZATION_ERROR",
      statusCode: 403,
    });
  }
}

export class EmailOrUsernameAlreadyExistsError extends ServiceError {
    constructor(message: string) {
      super(message, {
        code: "EMAILORUSERNAMEALREADYEXISTS_ERROR",
        statusCode: 403,
      });
    }
  }