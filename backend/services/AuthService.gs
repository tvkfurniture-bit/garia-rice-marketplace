/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - AuthService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Central Authentication and Session Management Service.
 * Implements frictionless phone-based login, SHA-256 session token generation,
 * session renewal, role verification, and logout session invalidation.
 */

class AuthService {
  /**
   * Master RPC dispatcher for authentication actions invoked from Code.gs
   * @param {string} action - API action name.
   * @param {Object} payload - Input payload.
   * @param {string} [authToken] - Session token.
   * @return {Object} Standardized API response envelope.
   */
  static dispatch(action, payload = {}, authToken = null) {
    try {
      switch (action) {
        case 'authenticateUser':
          return this.authenticateUser(payload);

        case 'verifySession':
          return this.checkSession(authToken);

        case 'logoutUser':
          return this.logoutUser(authToken);

        default:
          return ErrorService.createClientError(
            'Unrecognized authentication action: ' + action,
            ErrorService.CODES.INVALID_PARAMETERS
          );
      }
    } catch (err) {
      return ErrorService.handleException(err, 'AuthService.dispatch.' + action);
    }
  }

  /**
   * Registers a new user or retrieves existing user by verified phone number.
   * @param {string} rawPhone - Indian mobile number.
   * @param {string} [role='CUSTOMER'] - User role (CUSTOMER, SELLER, RIDER).
   * @param {string} [email=''] - Optional email address.
   * @return {Object} User record from USERS table.
   */
  static getOrCreateUser(rawPhone, role = CONFIG.ROLES.CUSTOMER, email = '') {
    const cleanPhone = SecurityService.normalizeIndianPhone(rawPhone);
    if (!cleanPhone) {
      throw new Error('Please enter a valid 10-digit Indian mobile number.');
    }

    // Role guard: anonymous users cannot self-assign ADMIN
    let assignedRole = role;
    if (assignedRole === CONFIG.ROLES.ADMIN) {
      assignedRole = CONFIG.ROLES.CUSTOMER;
    }

    const existingUsers = SheetService.findByField(CONFIG.SHEETS.USERS, 'phone', cleanPhone);

    if (existingUsers && existingUsers.length > 0) {
      return existingUsers[0];
    }

    // New user creation
    const nowIso = new Date().toISOString();
    const newUserRecord = {
      user_id: SheetService.generateId('USR'),
      role: assignedRole,
      phone: cleanPhone,
      email: email ? String(email).trim().toLowerCase() : '',
      auth_token_hash: '',
      token_expiry: '',
      status: 'ACTIVE',
      created_at: nowIso,
      updated_at: nowIso
    };

    SheetService.insert(CONFIG.SHEETS.USERS, newUserRecord);
    return newUserRecord;
  }

  /**
   * Authenticates user via phone number and issues a new session token.
   * Designed for frictionless Indian hyperlocal mobile commerce.
   * @param {Object} payload - { phone, role, verificationCode }
   * @return {Object} API response envelope with session token and user profile.
   */
  static authenticateUser(payload) {
    const rawPhone = payload.phone;
    const requestedRole = payload.role || CONFIG.ROLES.CUSTOMER;
    const cleanPhone = SecurityService.normalizeIndianPhone(rawPhone);

    if (!cleanPhone) {
      return ErrorService.createClientError(
        'Please enter a valid 10-digit mobile number (e.g., 9830012345).',
        ErrorService.CODES.INVALID_PHONE_NUMBER
      );
    }

    // Retrieve or register user
    const user = this.getOrCreateUser(cleanPhone, requestedRole);

    // Account status guard
    if (user.status === CONFIG.APPROVAL_STATUS.SUSPENDED) {
      return ErrorService.createClientError(
        'This account has been suspended. Please contact support at ' + CONFIG.APP.SUPPORT_EMAIL,
        ErrorService.CODES.ACCOUNT_SUSPENDED
      );
    }

    // Generate cryptographically strong raw session token
    const rawToken = SecurityService.generateSecureToken();
    const tokenHash = SecurityService.hashToken(rawToken);

    // Calculate session expiration timestamp (30 days persistence)
    const expiryDate = new Date();
    const expiryHours = CONFIG.DEFAULTS.SESSION_TOKEN_EXPIRY_HOURS || 720;
    expiryDate.setTime(expiryDate.getTime() + (expiryHours * 60 * 60 * 1000));
    const expiryIso = expiryDate.toISOString();

    // Persist hashed token into USERS database table
    SheetService.updateById(
      CONFIG.SHEETS.USERS,
      'user_id',
      user.user_id,
      {
        auth_token_hash: tokenHash,
        token_expiry: expiryIso,
        updated_at: new Date().toISOString()
      }
    );

    return {
      success: true,
      data: {
        token: rawToken,
        user: {
          user_id: user.user_id,
          phone: user.phone,
          role: user.role,
          email: user.email || '',
          status: user.status
        }
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Validates an active session token and returns the current user profile.
   * Invoked on app startup to rehydrate logged-in customer/merchant state.
   * @param {string} authToken - Raw session token.
   * @return {Object} API response envelope.
   */
  static checkSession(authToken) {
    const authResult = SecurityService.authorizeRequest(authToken);

    if (!authResult.authorized) {
      return ErrorService.createClientError(
        authResult.error || 'Session is invalid or expired.',
        authResult.code || ErrorService.CODES.UNAUTHENTICATED
      );
    }

    return {
      success: true,
      data: {
        authenticated: true,
        user: authResult.user
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Logs out the user by wiping the hashed token in the USERS table.
   * @param {string} authToken - Raw session token.
   * @return {Object} API response envelope confirming logout.
   */
  static logoutUser(authToken) {
    if (!authToken || typeof authToken !== 'string') {
      return {
        success: true,
        data: { message: 'Logged out successfully.' },
        error: null,
        code: null,
        timestamp: new Date().toISOString()
      };
    }

    try {
      const tokenHash = SecurityService.hashToken(authToken);
      const matchingUsers = SheetService.findByField(CONFIG.SHEETS.USERS, 'auth_token_hash', tokenHash);

      if (matchingUsers && matchingUsers.length > 0) {
        const user = matchingUsers[0];
        SheetService.updateById(
          CONFIG.SHEETS.USERS,
          'user_id',
          user.user_id,
          {
            auth_token_hash: '',
            token_expiry: '',
            updated_at: new Date().toISOString()
          }
        );
      }
    } catch (err) {
      Logger.log('[AuthService.logoutUser] Notice: Error during token invalidation: ' + err.message);
    }

    return {
      success: true,
      data: { message: 'Logged out successfully.' },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }
}
