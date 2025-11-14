import * as openid from 'openid-client'

export type AuthState = {
  user?: openid.UserInfoResponse & {
    roles: string[]
  }

  openidConfig: openid.Configuration
}
