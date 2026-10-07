/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - AuditService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Immutable Audit Trail and Operational Event Logger.
 * Records all critical state changes, price shifts, and admin approvals into
 * the AUDIT_LOG sheet without blocking core business transactions.
 */

class AuditService {
  /**
   * Primary audit logging method.
   * Appends an immutable audit event to the AUDIT_LOG table.
   * Fully failsafe: errors are logged to console and will not crash parent workflows.
   * @param {string} actorId - ID of user or system component performing action.
   * @param {string} actorRole - Role of the actor (CUSTOMER, SELLER, RIDER, ADMIN, SYSTEM).
   * @param {string} actionVerb - Action name (e.g., 'ORDER_CONFIRMED', 'PRICE_UPDATED').
   * @param {string} entityName - Target entity (e.g., 'ORDERS', 'PRODUCTS', 'SELLERS').
   * @param {string} entityId - Target entity identifier (e.g., Order ID, Product ID).
   * @param {Object|string} [oldState=null] - Previous state or snapshot before mutation.
   * @param {Object|string} [newState=null] - New state or snapshot after mutation.
   * @param {string} [contextNotes=''] - Additional metadata or user agent note.
   * @return {boolean} True if successfully persisted, false if failed.
   */
  static logEvent(
    actorId,
    actorRole,
    actionVerb,
    entityName,
    entityId,
    oldState = null,
    newState = null,
    contextNotes = ''
  ) {
    try {
      const nowIso = new Date().toISOString();

      // Safely serialize state snapshots
      const oldStateJson = oldState
        ? (typeof oldState === 'object' ? JSON.stringify(oldState) : String(oldState))
        : '';

      const newStateJson = newState
        ? (typeof newState === 'object' ? JSON.stringify(newState) : String(newState))
        : '';

      const auditRecord = {
        audit_id: SheetService.generateId('AUD'),
        actor_id: actorId ? String(actorId).trim() : 'SYSTEM',
        actor_role: actorRole || CONFIG.ROLES.SYSTEM,
        action_verb: String(actionVerb || 'UNKNOWN_ACTION').toUpperCase(),
        entity_name: String(entityName || 'SYSTEM').toUpperCase(),
        entity_id: String(entityId || 'N/A').trim(),
        old_state_json: oldStateJson,
        new_state_json: newStateJson,
        ip_or_useragent: contextNotes ? String(contextNotes).substring(0, 255) : 'GariaRice-Client',
        timestamp: nowIso
      };

      // Persist to AUDIT_LOG sheet
      SheetService.insert(CONFIG.SHEETS.AUDIT_LOG, auditRecord);
      return true;

    } catch (err) {
      // Non-blocking failsafe: Log failure to console; never crash customer order flow
      Logger.log('[AuditService.logEvent] WARNING: Failed to record audit log: ' + err.message);
      return false;
    }
  }

  /**
   * Specialized logger: Order state transition.
   * @param {string} orderId - Canonical Order ID.
   * @param {string} actorId - ID of actor triggering transition.
   * @param {string} actorRole - Role of actor.
   * @param {string} fromStatus - Previous order status.
   * @param {string} toStatus - New order status.
   * @param {string} [remarks=''] - Optional remarks.
   * @return {boolean} Success status.
   */
  static logOrderTransition(orderId, actorId, actorRole, fromStatus, toStatus, remarks = '') {
    return this.logEvent(
      actorId,
      actorRole,
      'ORDER_STATUS_SHIFT',
      CONFIG.SHEETS.ORDERS,
      orderId,
      { status: fromStatus },
      { status: toStatus, remarks: remarks },
      'Status change: ' + fromStatus + ' -> ' + toStatus
    );
  }

  /**
   * Specialized logger: Product rice price or stock modification.
   * @param {string} productId - Product ID.
   * @param {string} sellerId - Owning merchant ID.
   * @param {number} oldPrice - Previous selling price in INR.
   * @param {number} newPrice - New selling price in INR.
   * @param {string} [reason=''] - Merchant reason for price update.
   * @return {boolean} Success status.
   */
  static logProductPriceChange(productId, sellerId, oldPrice, newPrice, reason = '') {
    return this.logEvent(
      sellerId,
      CONFIG.ROLES.SELLER,
      'PRODUCT_PRICE_UPDATED',
      CONFIG.SHEETS.PRODUCTS,
      productId,
      { price_inr: oldPrice },
      { price_inr: newPrice, reason: reason },
      'Price adjusted from ₹' + oldPrice + ' to ₹' + newPrice
    );
  }

  /**
   * Specialized logger: Admin onboarding and KYC approval shifts.
   * @param {string} entityType - 'SELLERS' or 'DELIVERY_PARTNERS' or 'PRODUCTS'.
   * @param {string} entityId - Target entity ID.
   * @param {string} adminId - Administrator user ID.
   * @param {string} oldStatus - Previous approval status.
   * @param {string} newStatus - New approval status.
   * @param {string} [reason=''] - Admin notes.
   * @return {boolean} Success status.
   */
  static logApprovalShift(entityType, entityId, adminId, oldStatus, newStatus, reason = '') {
    return this.logEvent(
      adminId,
      CONFIG.ROLES.ADMIN,
      'APPROVAL_STATUS_CHANGED',
      entityType,
      entityId,
      { status: oldStatus },
      { status: newStatus, reason: reason },
      'Admin updated ' + entityType + ' approval: ' + oldStatus + ' -> ' + newStatus
    );
  }

  /**
   * Retrieves recent audit logs for administrative inspection.
   * @param {string} [entityName=null] - Optional filter by entity table.
   * @param {string} [entityId=null] - Optional filter by specific record ID.
   * @param {number} [limit=50] - Maximum audit records to return.
   * @return {Object[]} Array of audit record objects (newest first).
   */
  static getAuditTrail(entityName = null, entityId = null, limit = 50) {
    try {
      const filterFn = (record) => {
        if (entityName && String(record.entity_name).toUpperCase() !== String(entityName).toUpperCase()) {
          return false;
        }
        if (entityId && String(record.entity_id).trim() !== String(entityId).trim()) {
          return false;
        }
        return true;
      };

      // Sort newest first by timestamp
      const sortFn = (a, b) => {
        const timeA = new Date(a.timestamp).getTime() || 0;
        const timeB = new Date(b.timestamp).getTime() || 0;
        return timeB - timeA;
      };

      return SheetService.query(CONFIG.SHEETS.AUDIT_LOG, filterFn, sortFn, limit);

    } catch (err) {
      Logger.log('[AuditService.getAuditTrail] Error querying audit trail: ' + err.message);
      return [];
    }
  }
}
