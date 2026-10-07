/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - SecurityService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Enterprise-grade security enforcement layer.
 * Implements RBAC gatekeeping, SHA-256 session token hashing, IDOR defense,
 * XSS neutralization, and strict Indian phone/pincode pattern validation.
 */

class SecurityService {
  /**
   * Sanitizes user-submitted plain text.
   * Strips HTML tags, trims whitespace, and limits maximum length to prevent buffer abuse.
   * @param {*} input - Value to sanitize.
   * @param {number} [maxLength=500] - Maximum allowed string length.
   * @return {string} Sanitized plain text.
   */
  static sanitizeText(input, maxLength = 500) {
    if (input === null || input === undefined) {
      return '';
    }
    const str = String(input);
    // Strip HTML tags and control characters
    const stripped = str.replace(/<[^>]*>?/gm, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return stripped.trim().substring(0, maxLength);
  }

  /**
   * Validates standard 10-digit Indian mobile phone numbers.
   * Accepts formats: "9830012345", "+919830012345", "09830012345".
   * Normalizes output to clean 10-digit format.
   * @param {string} phone - Input phone number.
   * @return {string|null} Normalized 10-digit phone number or null if invalid.
   */
  static normalizeIndianPhone(phone) {
    if (!phone) {
      return null;
    }
    // Remove all non-digit characters
    let clean = String(phone).replace(/\D/g, '');

    // Strip country code +91 or leading 0 if present
    if (clean.length === 12 && clean.startsWith('91')) {
      clean = clean.substring(2);
    } else if (clean.length === 11 && clean.startsWith('0')) {
      clean = clean.substring(1);
    }

    // Must be exactly 10 digits starting with 6, 7, 8, or 9
    const isValid = /^[6-9]\d{9}$/.test(clean);
    return isValid ? clean : null;
  }

  /**
   * Validates 6-digit Indian Postal PIN codes.
   * @param {string|number} pincode - Postal PIN.
   * @return {boolean} True if valid 6-digit Indian pincode.
   */
  static isValidPincode(pincode) {
    if (!pincode) {
      return false;
    }
    const clean = String(pincode).trim();
    return /^[1-9][0-9]{5}$/.test(clean);
  }

  /**
   * Validates email address format.
   * @param {string} email - Email address string.
   * @return {boolean} True if valid email format.
   */
  static isValidEmail(email) {
    if (!email) {
      return false;
    }
    const clean = String(email).trim().toLowerCase();
    const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    return regex.test(clean);
  }

  /**
   * Safely bounds and sanitizes numeric inputs (prices, weights, quantities).
   * @param {*} value - Value to parse.
   * @param {number} min - Minimum allowed bound.
   * @param {number} max - Maximum allowed bound.
   * @param {number} defaultValue - Fallback value if invalid.
   * @return {number} Sanitized floating-point or integer number.
   */
  static sanitizeNumber(value, min = 0, max = 1000000, defaultValue = 0) {
    const num = parseFloat(value);
    if (isNaN(num)) {
      return defaultValue;
    }
    return Math.max(min, Math.min(max, num));
  }

  /**
   * Generates a collision-resistant, cryptographically strong session token.
   * Combines UUID v4 with timestamp and random hex bytes.
   * @return {string} Secure raw session token.
   */
  static generateSecureToken() {
    const uuid = Utilities.getUuid();
    const timeHex = new Date().getTime().toString(16);
    const randHex = Math.floor(Math.random() * 0xFFFFFF).toString(16);
    return 'GRM_SEC_' + uuid.replace(/-/g, '') + timeHex + randHex;
  }

  /**
   * Computes SHA-256 cryptographic digest of a token or sensitive string.
   * Used so plain-text tokens are NEVER stored in Google Sheets.
   * @param {string} rawToken - Raw session token.
   * @return {string} Hex-encoded SHA-256 hash.
   */
  static hashToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') {
      return '';
    }
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      rawToken,
      Utilities.Charset.UTF_8
    );
    // Convert byte array to hex string
    return digest.map(byte => {
      const b = (byte < 0 ? byte + 256 : byte).toString(16);
      return b.length === 1 ? '0' + b : b;
    }).join('');
  }

  /**
   * Master Role-Based Access Control (RBAC) authorizer.
   * Validates token existence, SHA-256 hash match, expiration, account status,
   * and role authorization against the USERS database table.
   * @param {string} authToken - Raw session token supplied by client.
   * @param {string[]} [allowedRoles] - Array of permitted roles (e.g. ['SELLER', 'ADMIN']).
   * @return {Object} Authorization envelope { authorized, user, error, code }.
   */
  static authorizeRequest(authToken, allowedRoles = []) {
    const result = {
      authorized: false,
      user: null,
      error: null,
      code: null
    };

    if (!authToken || typeof authToken !== 'string') {
      result.error = 'Authentication token required.';
      result.code = ErrorService.CODES.UNAUTHENTICATED;
      return result;
    }

    try {
      const tokenHash = this.hashToken(authToken);
      
      // Look up user by hashed token in USERS table
      const users = SheetService.findByField(CONFIG.SHEETS.USERS, 'auth_token_hash', tokenHash);
      if (!users || users.length === 0) {
        result.error = 'Invalid or expired session. Please log in again.';
        result.code = ErrorService.CODES.UNAUTHENTICATED;
        return result;
      }

      const user = users[0];

      // Verify token expiration
      if (user.token_expiry) {
        const expiryDate = new Date(user.token_expiry);
        if (new Date() > expiryDate) {
          result.error = 'Session has expired. Please log in again.';
          result.code = ErrorService.CODES.SESSION_EXPIRED;
          return result;
        }
      }

      // Verify account status
      if (user.status === CONFIG.APPROVAL_STATUS.SUSPENDED) {
        result.error = 'Account is suspended. Please contact marketplace support.';
        result.code = ErrorService.CODES.ACCOUNT_SUSPENDED;
        return result;
      }

      if (user.status !== 'ACTIVE') {
        result.error = 'Account is not active (Status: ' + user.status + ').';
        result.code = ErrorService.CODES.ACCOUNT_PENDING_REVIEW;
        return result;
      }

      // Verify Role permissions if allowedRoles specified
      if (allowedRoles && allowedRoles.length > 0) {
        // ADMIN role possesses universal access across all operations
        const isPermitted = allowedRoles.includes(user.role) || user.role === CONFIG.ROLES.ADMIN;
        if (!isPermitted) {
          result.error = 'Access denied: Insufficient privileges for role [' + user.role + '].';
          result.code = ErrorService.CODES.UNAUTHORIZED;
          return result;
        }
      }

      // Authorization successful
      result.authorized = true;
      result.user = {
        user_id: user.user_id,
        role: user.role,
        phone: user.phone,
        email: user.email,
        status: user.status
      };
      return result;

    } catch (err) {
      Logger.log('[SecurityService.authorizeRequest] Error during auth check: ' + err.message);
      result.error = 'Security service encountered an internal verification error.';
      result.code = ErrorService.CODES.INTERNAL_SERVER_ERROR;
      return result;
    }
  }

  /**
   * Insecure Direct Object Reference (IDOR) Ownership Assertion.
   * Guarantees that a customer, seller, or rider can ONLY access/mutate their own
   * orders, products, or addresses. Administrators bypass this check.
   * @param {string} recordOwnerId - User or Merchant ID that owns the target record.
   * @param {string} authenticatedUserId - Currently authenticated User ID.
   * @param {string} authenticatedRole - Role of the authenticated user.
   * @return {boolean} True if access is permitted, false if IDOR violation.
   */
  static assertOwnership(recordOwnerId, authenticatedUserId, authenticatedRole) {
    if (!recordOwnerId || !authenticatedUserId) {
      return false;
    }

    // Admins have supervisory override authority
    if (authenticatedRole === CONFIG.ROLES.ADMIN) {
      return true;
    }

    // Direct match check (ensures Seller A cannot update Seller B's product/order)
    return String(recordOwnerId).trim() === String(authenticatedUserId).trim();
  }
}
