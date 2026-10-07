/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - ErrorService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Centralized exception handler and security-conscious error logger.
 * Sanitizes server exceptions into friendly client responses and prevents
 * leakage of spreadsheet IDs, stack traces, and internal script metadata.
 */

class ErrorService {
  /**
   * Standardized business and operational error codes
   */
  static get CODES() {
    return {
      // Input & Validation Errors
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      INVALID_PARAMETERS: 'INVALID_PARAMETERS',
      MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
      INVALID_PHONE_NUMBER: 'INVALID_PHONE_NUMBER',
      INVALID_PINCODE: 'INVALID_PINCODE',
      INVALID_PACK_SIZE: 'INVALID_PACK_SIZE',

      // Authentication & Authorization Errors
      UNAUTHENTICATED: 'UNAUTHENTICATED',
      UNAUTHORIZED: 'UNAUTHORIZED',
      SESSION_EXPIRED: 'SESSION_EXPIRED',
      INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
      ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
      ACCOUNT_PENDING_REVIEW: 'ACCOUNT_PENDING_REVIEW',

      // Resource & Entity Errors
      NOT_FOUND: 'NOT_FOUND',
      SELLER_NOT_FOUND: 'SELLER_NOT_FOUND',
      PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
      ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
      RIDER_NOT_FOUND: 'RIDER_NOT_FOUND',
      DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',

      // Order & State Machine Errors
      ORDER_INVALID_STATE: 'ORDER_INVALID_STATE',
      MULTI_SELLER_CART_NOT_ALLOWED: 'MULTI_SELLER_CART_NOT_ALLOWED',
      CART_EMPTY: 'CART_EMPTY',
      OUT_OF_STOCK: 'OUT_OF_STOCK',
      SELLER_TIMEOUT: 'SELLER_TIMEOUT',
      RIDER_CAPACITY_EXCEEDED: 'RIDER_CAPACITY_EXCEEDED',

      // System & Concurrency Errors
      CONCURRENCY_LOCK_FAILED: 'CONCURRENCY_LOCK_FAILED',
      DATABASE_UNREACHABLE: 'DATABASE_UNREACHABLE',
      QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
      INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
      NOT_IMPLEMENTED: 'NOT_IMPLEMENTED'
    };
  }

  /**
   * Constructs a sanitized, client-safe error response envelope.
   * @param {string} userMessage - Friendly error message suitable for UI display.
   * @param {string} [code] - Registered error code from ErrorService.CODES.
   * @param {*} [extraData] - Optional safe metadata (e.g. invalid field names).
   * @return {Object} Standardized API error envelope.
   */
  static createClientError(userMessage, code = 'VALIDATION_ERROR', extraData = null) {
    return {
      success: false,
      data: extraData,
      error: userMessage || 'An unexpected error occurred. Please try again.',
      code: code || this.CODES.VALIDATION_ERROR,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Sanitizes raw error strings by stripping sensitive spreadsheet IDs,
   * script file paths, and internal stack trace line numbers.
   * @param {string|Error} rawError - Raw error or exception object.
   * @return {string} Sanitized text string.
   */
  static sanitizeErrorMessage(rawError) {
    if (!rawError) {
      return 'Unknown error';
    }

    let message = typeof rawError === 'string' ? rawError : (rawError.message || String(rawError));

    // Strip Google Spreadsheet IDs (alphanumeric strings with dashes/underscores >= 30 chars)
    message = message.replace(/[a-zA-Z0-9-_]{30,}/g, '[PROTECTED_RESOURCE_ID]');

    // Strip internal Apps Script stack path references
    message = message.replace(/at\s+.*\(.*:[0-9]+:[0-9]+\)/g, '');
    message = message.replace(/line\s+[0-9]+/gi, '');

    // Trim excessive whitespace
    return message.replace(/\s+/g, ' ').trim();
  }

  /**
   * Master exception processor.
   * Logs internal stack trace to server console, optionally records to AUDIT_LOG,
   * and returns a safe sanitized DTO for frontend consumption.
   * @param {Error|Object|string} err - Caught exception.
   * @param {string} [contextAction] - Action name during which exception occurred.
   * @param {string} [actorId] - User or system ID that triggered request.
   * @return {Object} Client-safe error response envelope.
   */
  static handleException(err, contextAction = 'UNKNOWN_ACTION', actorId = 'SYSTEM') {
    const rawMessage = err ? (err.message || String(err)) : 'Unknown exception';
    const stackTrace = err && err.stack ? err.stack : 'No stack trace available';
    const timestamp = new Date().toISOString();

    // 1. Log full diagnostic details server-side (visible only in Apps Script Execution Log)
    Logger.log('================================================================');
    Logger.log('[ErrorService] FATAL EXCEPTION CAUGHT');
    Logger.log('Timestamp: ' + timestamp);
    Logger.log('Context Action: ' + contextAction);
    Logger.log('Actor: ' + actorId);
    Logger.log('Message: ' + rawMessage);
    Logger.log('Stack: ' + stackTrace);
    Logger.log('================================================================');

    // 2. Attempt persistent logging to AUDIT_LOG sheet (failsafe, non-crashing)
    this.recordAuditError_(contextAction, actorId, rawMessage, stackTrace, timestamp);

    // 3. Map to safe customer-facing error message and code
    let clientMessage = 'An unexpected server error occurred. Please try again.';
    let clientCode = this.CODES.INTERNAL_SERVER_ERROR;

    if (rawMessage.includes('[SheetService]') || rawMessage.includes('Database')) {
      clientMessage = 'The marketplace database is experiencing high traffic. Please retry in a few moments.';
      clientCode = this.CODES.CONCURRENCY_LOCK_FAILED;
    } else if (rawMessage.includes('Quota') || rawMessage.includes('Service invoked too many times')) {
      clientMessage = 'Daily notification or processing quota reached. Please contact marketplace support.';
      clientCode = this.CODES.QUOTA_EXCEEDED;
    } else if (rawMessage.includes('Permission') || rawMessage.includes('Access denied')) {
      clientMessage = 'You do not have permission to perform this action.';
      clientCode = this.CODES.UNAUTHORIZED;
    } else if (rawMessage.includes('not found') || rawMessage.includes('NOT_FOUND')) {
      clientMessage = 'The requested item or record could not be found.';
      clientCode = this.CODES.NOT_FOUND;
    }

    return this.createClientError(clientMessage, clientCode);
  }

  /**
   * Internal helper: records exception event in the AUDIT_LOG sheet.
   * Fully isolated in try/catch to avoid recursive failure.
   * @private
   */
  static recordAuditError_(action, actorId, rawMessage, stackTrace, timestamp) {
    try {
      if (typeof SheetService !== 'undefined' && typeof SheetService.insert === 'function') {
        const auditRecord = {
          audit_id: SheetService.generateId('ERR'),
          actor_id: actorId || 'SYSTEM',
          actor_role: CONFIG.ROLES.SYSTEM,
          action_verb: 'SERVER_EXCEPTION',
          entity_name: 'SYSTEM',
          entity_id: action || 'UNKNOWN',
          old_state_json: '',
          new_state_json: JSON.stringify({
            error: this.sanitizeErrorMessage(rawMessage),
            context: action
          }),
          ip_or_useragent: 'AppsScript-V8',
          timestamp: timestamp
        };

        // Write to AUDIT_LOG table
        SheetService.insert(CONFIG.SHEETS.AUDIT_LOG, auditRecord);
      }
    } catch (auditErr) {
      // Critical failsafe: if writing to AUDIT_LOG fails, log to console and do NOT crash
      Logger.log('[ErrorService.recordAuditError_] Failed to write error to AUDIT_LOG: ' + auditErr.message);
    }
  }
}
