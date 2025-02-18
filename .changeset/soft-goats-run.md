---
'@getcronit/pylon': major
---

**Summary:**
This changeset introduces a major overhaul to the built-in authentication system. The new implementation automatically sets up `/auth/login`, `/auth/callback`, and `/auth/logout` routes, injects an `auth` object into the context, and manages token cookies. Role-based route protection is now enhanced via `authMiddleware` and the updated `requireAuth` decorator, configurable through the streamlined `useAuth` plugin.

---

**Breaking Changes:**

- **WHAT:**  
  The authentication configuration has been completely revamped. The previous manual setup is replaced by the `useAuth` plugin. Custom authentication route definitions are no longer necessary, and existing middleware or decorator usage may require adjustments.

- **WHY:**  
  This change was implemented to simplify authentication setup, reduce boilerplate, improve security by automating context and cookie management, and offer better role-based access control.

- **HOW:**  
  Consumers should:
  1. Remove any custom authentication route setups.
  2. Update their configuration to use the new `useAuth` plugin as shown below:
     ```typescript
     export const config: PylonConfig = {
       plugins: [
         useAuth({
           issuer: 'https://test-0o6zvq.zitadel.cloud',
           endpoint: '/auth',
           keyPath: 'key.json'
         })
       ]
     }
     ```
  3. Replace previous authentication middleware or decorators with the updated `requireAuth` and `authMiddleware` APIs.
  4. Test the new authentication endpoints (`/auth/login`, `/auth/callback`, and `/auth/logout`) to ensure proper integration.

Ensure you update your code accordingly to avoid disruptions in your authentication flow.
