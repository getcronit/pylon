// errors/user.errors.ts
import { ServiceError } from "@getcronit/pylon";

export class UserNotFoundError extends ServiceError {
  constructor(id: string) {
    const message = `User with ID '${id}' was not found. Please double-check the ID and try again.`;

    super(message, {
      statusCode: 404,
      code: "USER_NOT_FOUND",
    });
  }
}

export class EmailOrUsernameAlreadyExistsError extends ServiceError {
  constructor(loginName: string) {
    const message = `Email or username'${loginName}' already exists.`;

    super(message, {
      code: "EMAILORUSERNAMEALREADYEXISTS_ERROR",
      statusCode: 403,
    });
  }
}