import { app } from '@getcronit/pylon'
import { getResolvedFields } from './get-resolved-fields'

const getUser = (): {
  firstName: string,
  lastName: string,
  username: string
} => {
  const fields = getResolvedFields()

  return {
    firstName: fields.nestedFields.user.flatFields.includes("firstName") ? "John" : "",
    lastName: fields.nestedFields.user.flatFields.includes("lastName") ? "Doe" : "",
    username: fields.nestedFields.user.flatFields.includes("username") ? "johndoe" : ""
  }
}

export const graphql = {
  Query: {
    data: () => {

      const user = getUser()

      console.log("Got user", user)

      return {
        user,
      }
    }
  },
  Mutation: {}
}

export default app
