/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - OrderService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Master Order Lifecycle and Finite State Machine Execution Engine.
 * Enforces single-seller checkout, zero-client-trust price recalculation,
 * atomic LockService persistence, strict status transitions, and audit logs.
 */

class OrderService {
  /**
   * Master RPC dispatcher invoked by Code.gs clientApiCall
   * @param {string} action - API action name.
   * @param {Object} payload - Input payload.
   * @param {string} [authToken] - Session token.
   * @return {Object} Standardized API response envelope.
   */
  static dispatch(action, payload = {}, authToken = null) {
    try {
      switch (action) {
        case 'createOrder':
          return this.createOrder(payload, authToken);

        case 'getOrderDetails':
          return this.getOrderDetails(payload.order_id, authToken);

        case 'updateOrderStatus':
          return this.handleStatusUpdateRpc(payload, authToken);

        case 'trackOrderPublic':
          return this.trackOrderPublic(payload.order_id, payload.phone_last_4);

        default:
          return ErrorService.createClientError(
            'Unrecognized order action: ' + action,
            ErrorService.CODES.INVALID_PARAMETERS
          );
      }
    } catch (err) {
      return ErrorService.handleException(err, 'OrderService.dispatch.' + action);
    }
  }

  /**
   * Finite State Machine: Permitted state transitions and authorized actors.
   * Strictly enforces the lifecycle:
   * PLACED -> SELLER_CONFIRMED -> PACKING -> READY_FOR_PICKUP -> RIDER_ASSIGNED ->
   * RIDER_ACCEPTED -> PICKED_UP -> OUT_FOR_DELIVERY -> DELIVERED -> COMPLETED
   */
  static get ALLOWED_TRANSITIONS() {
    return {
      [CONFIG.ORDER_STATUS.PLACED]: [
        { to: CONFIG.ORDER_STATUS.SELLER_CONFIRMED, roles: [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN] },
        { to: CONFIG.ORDER_STATUS.SELLER_REJECTED, roles: [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN] },
        { to: CONFIG.ORDER_STATUS.CANCELLED_BY_CUSTOMER, roles: [CONFIG.ROLES.CUSTOMER, CONFIG.ROLES.ADMIN] }
      ],
      [CONFIG.ORDER_STATUS.SELLER_CONFIRMED]: [
        { to: CONFIG.ORDER_STATUS.PACKING, roles: [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN] },
        { to: CONFIG.ORDER_STATUS.READY_FOR_PICKUP, roles: [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN] },
        { to: CONFIG.ORDER_STATUS.CANCELLED_BY_SELLER, roles: [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN] }
      ],
      [CONFIG.ORDER_STATUS.PACKING]: [
        { to: CONFIG.ORDER_STATUS.READY_FOR_PICKUP, roles: [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN] },
        { to: CONFIG.ORDER_STATUS.CANCELLED_BY_SELLER, roles: [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN] }
      ],
      [CONFIG.ORDER_STATUS.READY_FOR_PICKUP]: [
        { to: CONFIG.ORDER_STATUS.RIDER_ASSIGNED, roles: [CONFIG.ROLES.SYSTEM, CONFIG.ROLES.ADMIN] },
        { to: CONFIG.ORDER_STATUS.CANCELLED_BY_SELLER, roles: [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN] }
      ],
      [CONFIG.ORDER_STATUS.RIDER_ASSIGNED]: [
        { to: CONFIG.ORDER_STATUS.RIDER_ACCEPTED, roles: [CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN] },
        { to: CONFIG.ORDER_STATUS.READY_FOR_PICKUP, roles: [CONFIG.ROLES.SYSTEM, CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN] } // Rider rejection / timeout
      ],
      [CONFIG.ORDER_STATUS.RIDER_ACCEPTED]: [
        { to: CONFIG.ORDER_STATUS.PICKED_UP, roles: [CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN] },
        { to: CONFIG.ORDER_STATUS.READY_FOR_PICKUP, roles: [CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN] } // Release
      ],
      [CONFIG.ORDER_STATUS.PICKED_UP]: [
        { to: CONFIG.ORDER_STATUS.OUT_FOR_DELIVERY, roles: [CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN] }
      ],
      [CONFIG.ORDER_STATUS.OUT_FOR_DELIVERY]: [
        { to: CONFIG.ORDER_STATUS.DELIVERED, roles: [CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN] },
        { to: CONFIG.ORDER_STATUS.DELIVERY_FAILED, roles: [CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN] }
      ],
      [CONFIG.ORDER_STATUS.DELIVERED]: [
        { to: CONFIG.ORDER_STATUS.CUSTOMER_CONFIRMED, roles: [CONFIG.ROLES.CUSTOMER, CONFIG.ROLES.SYSTEM, CONFIG.ROLES.ADMIN] },
        { to: CONFIG.ORDER_STATUS.REVIEW_REQUESTED, roles: [CONFIG.ROLES.SYSTEM, CONFIG.ROLES.ADMIN] }
      ],
      [CONFIG.ORDER_STATUS.CUSTOMER_CONFIRMED]: [
        { to: CONFIG.ORDER_STATUS.REVIEW_REQUESTED, roles: [CONFIG.ROLES.SYSTEM, CONFIG.ROLES.ADMIN] },
        { to: CONFIG.ORDER_STATUS.COMPLETED, roles: [CONFIG.ROLES.SYSTEM, CONFIG.ROLES.ADMIN] }
      ],
      [CONFIG.ORDER_STATUS.REVIEW_REQUESTED]: [
        { to: CONFIG.ORDER_STATUS.COMPLETED, roles: [CONFIG.ROLES.SYSTEM, CONFIG.ROLES.ADMIN] }
      ]
    };
  }

  /**
   * Generates a canonical Order ID.
   * Format: GRM-YYYYMMDD-XXXX
   * Example: GRM-20261007-0012
   * @return {string} Canonical Order ID.
   */
  static generateOrderId_() {
    const now = new Date();
    const dateStr = Utilities.formatDate(now, CONFIG.APP.TIMEZONE, 'yyyyMMdd');
    const randomHex = Math.floor(1000 + Math.random() * 9000).toString();
    return 'GRM-' + dateStr + '-' + randomHex;
  }

  /**
   * Master Order Creation Engine.
   * Wrapped in SheetService.withLock to prevent duplicate placement or race conditions.
   * @param {Object} payload - { seller_id, items: [{ product_id, quantity }], delivery_address, payment_method }
   * @param {string} authToken - Customer session token.
   * @return {Object} API response envelope with created order details.
   */
  static createOrder(payload, authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.CUSTOMER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const sellerId = payload.seller_id;
    const items = payload.items;
    const deliveryAddress = payload.delivery_address;
    const paymentMethod = payload.payment_method || CONFIG.PAYMENT_METHODS.COD;

    if (!sellerId || !Array.isArray(items) || items.length === 0) {
      return ErrorService.createClientError(
        'Cart must contain at least one rice product from a selected seller.',
        ErrorService.CODES.CART_EMPTY
      );
    }

    if (!deliveryAddress || !deliveryAddress.address_line || !deliveryAddress.locality) {
      return ErrorService.createClientError(
        'Complete delivery address and locality are required.',
        ErrorService.CODES.MISSING_REQUIRED_FIELD
      );
    }

    if (!SecurityService.isValidPincode(deliveryAddress.pincode)) {
      return ErrorService.createClientError(
        'Please provide a valid 6-digit postal PIN code in Garia / Kolkata.',
        ErrorService.CODES.INVALID_PINCODE
      );
    }

    // Critical Section: Recalculate verified financials and atomically insert records
    return SheetService.withLock(() => {
      // 1. Resolve customer profile
      const customer = CustomerService.getOrCreateCustomer(auth.user.user_id, auth.user.phone);

      // 2. Perform zero-client-trust pricing calculation
      const pricingBreakdown = PricingService.calculateOrderPricing(items, sellerId, deliveryAddress);

      // 3. Minimum order value guard
      const minOrderVal = CONFIG.DEFAULTS.MINIMUM_ORDER_VALUE_INR || 100.0;
      if (pricingBreakdown.subtotal_inr < minOrderVal) {
        return ErrorService.createClientError(
          'Minimum order value is ₹' + minOrderVal + '. Please add more items.',
          ErrorService.CODES.VALIDATION_ERROR
        );
      }

      // 4. Construct Order record matching Table 9 schema
      const orderId = this.generateOrderId_();
      const nowIso = new Date().toISOString();

      const orderRecord = {
        order_id: orderId,
        customer_id: customer.customer_id,
        seller_id: sellerId,
        current_status: CONFIG.ORDER_STATUS.PLACED,
        subtotal_inr: pricingBreakdown.subtotal_inr,
        delivery_fee_inr: pricingBreakdown.delivery_fee_inr,
        platform_fee_inr: 0.0,
        total_amount_inr: pricingBreakdown.total_amount_inr,
        commission_inr: pricingBreakdown.commission_inr,
        seller_payout_inr: pricingBreakdown.seller_payout_inr,
        rider_payout_inr: pricingBreakdown.rider_payout_inr,
        total_weight_kg: pricingBreakdown.total_weight_kg,
        delivery_address: JSON.stringify(deliveryAddress),
        delivery_locality: deliveryAddress.locality,
        approx_distance_km: pricingBreakdown.approx_distance_km,
        payment_method: paymentMethod,
        payment_status: CONFIG.PAYMENT_STATUS.PENDING,
        created_at: nowIso,
        updated_at: nowIso
      };

      // 5. Construct Order Items records matching Table 10 schema
      const orderItemRecords = pricingBreakdown.items.map(item => ({
        item_id: SheetService.generateId('ITM'),
        order_id: orderId,
        product_id: item.product_id,
        product_name: item.name,
        variety: item.variety,
        pack_size_kg: item.pack_size_kg,
        unit_price_inr: item.unit_price_inr,
        quantity: item.quantity,
        line_total_inr: item.line_total_inr,
        created_at: nowIso
      }));

      // 6. Construct initial Order Status Log record matching Table 11 schema
      const statusLogRecord = {
        log_id: SheetService.generateId('LOG'),
        order_id: orderId,
        from_status: '',
        to_status: CONFIG.ORDER_STATUS.PLACED,
        actor_id: customer.customer_id,
        actor_role: CONFIG.ROLES.CUSTOMER,
        remarks: 'Order placed by customer via web marketplace.',
        timestamp: nowIso
      };

      // 7. Atomic batch insertions
      SheetService.insert(CONFIG.SHEETS.ORDERS, orderRecord);
      SheetService.batchInsert(CONFIG.SHEETS.ORDER_ITEMS, orderItemRecords);
      SheetService.insert(CONFIG.SHEETS.ORDER_STATUS_LOG, statusLogRecord);

      // 8. Increment customer order count
      const updatedTotalOrders = (parseInt(customer.total_orders, 10) || 0) + 1;
      SheetService.updateById(
        CONFIG.SHEETS.CUSTOMERS,
        'customer_id',
        customer.customer_id,
        {
          total_orders: updatedTotalOrders,
          updated_at: nowIso
        }
      );

      // 9. Record system audit trail
      AuditService.logOrderTransition(
        orderId,
        customer.customer_id,
        CONFIG.ROLES.CUSTOMER,
        '',
        CONFIG.ORDER_STATUS.PLACED,
        'Initial order creation'
      );

      // 10. Trigger notification engine if loaded
      if (typeof NotificationEngine !== 'undefined' && typeof NotificationEngine.onOrderPlaced === 'function') {
        NotificationEngine.onOrderPlaced(orderRecord, pricingBreakdown.items);
      }

      return {
        success: true,
        data: {
          order_id: orderId,
          status: CONFIG.ORDER_STATUS.PLACED,
          total_amount_inr: pricingBreakdown.total_amount_inr,
          delivery_fee_inr: pricingBreakdown.delivery_fee_inr,
          seller_business_name: pricingBreakdown.seller_business_name,
          message: 'Order placed successfully! The seller has been notified for confirmation.'
        },
        error: null,
        code: null,
        timestamp: nowIso
      };
    });
  }

  /**
   * Finite State Machine Transition Engine.
   * Validates actor permissions, checks allowed transition rules, updates status,
   * appends to status log, and dispatches delivery matching if READY_FOR_PICKUP.
   * @param {string} orderId - Canonical Order ID.
   * @param {string} toStatus - Destination status.
   * @param {string} [remarks=''] - Transition notes.
   * @param {string} actorId - ID of user triggering transition.
   * @param {string} actorRole - Role of user triggering transition.
   * @return {Object} Transition result.
   */
  static transitionOrderStatus(orderId, toStatus, remarks = '', actorId, actorRole) {
    if (!orderId || !toStatus) {
      throw new Error('Both Order ID and Destination Status are required.');
    }

    return SheetService.withLock(() => {
      const order = SheetService.findById(CONFIG.SHEETS.ORDERS, 'order_id', orderId);
      if (!order) {
        throw new Error('Order [' + orderId + '] not found.');
      }

      const fromStatus = order.current_status;

      // Check transition validity in state machine graph
      const possibleTransitions = this.ALLOWED_TRANSITIONS[fromStatus] || [];
      const transitionRule = possibleTransitions.find(t => t.to === toStatus);

      if (!transitionRule) {
        throw new Error('Invalid status transition from [' + fromStatus + '] to [' + toStatus + '].');
      }

      // Check actor authorization
      const isAuthorizedRole = transitionRule.roles.includes(actorRole) || actorRole === CONFIG.ROLES.ADMIN;
      if (!isAuthorizedRole) {
        throw new Error('Actor with role [' + actorRole + '] is not authorized to transition order to [' + toStatus + '].');
      }

      const nowIso = new Date().toISOString();

      // Update ORDERS sheet
      const updatedOrder = SheetService.updateById(
        CONFIG.SHEETS.ORDERS,
        'order_id',
        orderId,
        {
          current_status: toStatus,
          updated_at: nowIso
        }
      );

      // Append entry to ORDER_STATUS_LOG sheet
      const statusLogRecord = {
        log_id: SheetService.generateId('LOG'),
        order_id: orderId,
        from_status: fromStatus,
        to_status: toStatus,
        actor_id: actorId || 'SYSTEM',
        actor_role: actorRole || CONFIG.ROLES.SYSTEM,
        remarks: remarks || ('Transitioned from ' + fromStatus + ' to ' + toStatus),
        timestamp: nowIso
      };
      SheetService.insert(CONFIG.SHEETS.ORDER_STATUS_LOG, statusLogRecord);

      // Audit log entry
      AuditService.logOrderTransition(orderId, actorId, actorRole, fromStatus, toStatus, remarks);

      // Trigger Delivery Assignment Engine when order becomes READY_FOR_PICKUP
      if (toStatus === CONFIG.ORDER_STATUS.READY_FOR_PICKUP) {
        if (typeof DeliveryService !== 'undefined' && typeof DeliveryService.dispatchOrderToRiders === 'function') {
          DeliveryService.dispatchOrderToRiders(order);
        }
      }

      // Trigger Notification Engine if loaded
      if (typeof NotificationEngine !== 'undefined' && typeof NotificationEngine.onOrderStatusChange === 'function') {
        NotificationEngine.onOrderStatusChange(order, fromStatus, toStatus);
      }

      return {
        order_id: orderId,
        from_status: fromStatus,
        to_status: toStatus,
        updated_at: nowIso
      };
    });
  }

  /**
   * Helper for RPC status update calls (e.g. Seller clicking CONFIRM or READY).
   * @private
   */
  static handleStatusUpdateRpc(payload, authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [
      CONFIG.ROLES.SELLER,
      CONFIG.ROLES.RIDER,
      CONFIG.ROLES.CUSTOMER,
      CONFIG.ROLES.ADMIN
    ]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const orderId = payload.order_id;
    const toStatus = payload.to_status;
    const remarks = payload.remarks || '';

    // Verify ownership: if seller, must own the order
    if (auth.user.role === CONFIG.ROLES.SELLER) {
      const sellers = SheetService.findByField(CONFIG.SHEETS.SELLERS, 'user_id', auth.user.user_id);
      const sellerId = sellers.length > 0 ? sellers[0].seller_id : null;
      const order = SheetService.findById(CONFIG.SHEETS.ORDERS, 'order_id', orderId);
      if (!order || order.seller_id !== sellerId) {
        return ErrorService.createClientError('Unauthorized: You do not own this order.', ErrorService.CODES.UNAUTHORIZED);
      }
    }

    const result = this.transitionOrderStatus(orderId, toStatus, remarks, auth.user.user_id, auth.user.role);

    return {
      success: true,
      data: result,
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Retrieves complete order details with line items and milestone timeline.
   * Permitted for owning customer, assigned seller, assigned rider, or admin.
   * @param {string} orderId - Canonical Order ID.
   * @param {string} authToken - Session token.
   * @return {Object} Comprehensive order details DTO.
   */
  static getOrderDetails(orderId, authToken) {
    if (!orderId) {
      return ErrorService.createClientError('Order ID is required.', ErrorService.CODES.INVALID_PARAMETERS);
    }

    const auth = SecurityService.authorizeRequest(authToken, [
      CONFIG.ROLES.CUSTOMER,
      CONFIG.ROLES.SELLER,
      CONFIG.ROLES.RIDER,
      CONFIG.ROLES.ADMIN
    ]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const order = SheetService.findById(CONFIG.SHEETS.ORDERS, 'order_id', orderId);
    if (!order) {
      return ErrorService.createClientError('Order not found.', ErrorService.CODES.ORDER_NOT_FOUND);
    }

    // IDOR verification
    if (auth.user.role === CONFIG.ROLES.CUSTOMER) {
      const customer = SheetService.findByField(CONFIG.SHEETS.CUSTOMERS, 'user_id', auth.user.user_id);
      const customerId = customer.length > 0 ? customer[0].customer_id : null;
      if (order.customer_id !== customerId) {
        return ErrorService.createClientError('Access denied: You do not own this order.', ErrorService.CODES.UNAUTHORIZED);
      }
    } else if (auth.user.role === CONFIG.ROLES.SELLER) {
      const seller = SheetService.findByField(CONFIG.SHEETS.SELLERS, 'user_id', auth.user.user_id);
      const sellerId = seller.length > 0 ? seller[0].seller_id : null;
      if (order.seller_id !== sellerId) {
        return ErrorService.createClientError('Access denied: You are not the assigned merchant.', ErrorService.CODES.UNAUTHORIZED);
      }
    }

    // Fetch line items
    const items = SheetService.findByField(CONFIG.SHEETS.ORDER_ITEMS, 'order_id', orderId);

    // Fetch milestone timeline
    const statusLogs = SheetService.findByField(CONFIG.SHEETS.ORDER_STATUS_LOG, 'order_id', orderId);
    statusLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Fetch merchant details
    const seller = SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', order.seller_id);

    let address = {};
    try {
      address = typeof order.delivery_address === 'string'
        ? JSON.parse(order.delivery_address)
        : (order.delivery_address || {});
    } catch (e) {
      address = {};
    }

    return {
      success: true,
      data: {
        order_id: order.order_id,
        current_status: order.current_status,
        subtotal_inr: parseFloat(order.subtotal_inr) || 0,
        delivery_fee_inr: parseFloat(order.delivery_fee_inr) || 0,
        total_amount_inr: parseFloat(order.total_amount_inr) || 0,
        total_weight_kg: parseFloat(order.total_weight_kg) || 0,
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        delivery_address: address,
        approx_distance_km: parseFloat(order.approx_distance_km) || 0,
        created_at: order.created_at,
        updated_at: order.updated_at,
        seller: {
          seller_id: order.seller_id,
          business_name: seller ? seller.business_name : 'Local Rice Merchant',
          locality: seller ? seller.locality : 'Garia',
          whatsapp_phone: seller ? seller.whatsapp_phone : ''
        },
        items: items.map(i => ({
          product_id: i.product_id,
          name: i.product_name,
          variety: i.variety,
          pack_size_kg: parseFloat(i.pack_size_kg) || 0,
          unit_price_inr: parseFloat(i.unit_price_inr) || 0,
          quantity: parseInt(i.quantity, 10) || 1,
          line_total_inr: parseFloat(i.line_total_inr) || 0
        })),
        status_timeline: statusLogs.map(l => ({
          status: l.to_status,
          remarks: l.remarks,
          actor_role: l.actor_role,
          timestamp: l.timestamp
        }))
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Lightweight public tracking without full authentication.
   * Matches Order ID and last 4 digits of customer phone number for privacy.
   * @param {string} orderId - Canonical Order ID.
   * @param {string} phoneLast4 - Last 4 digits of buyer's mobile.
   * @return {Object} Safe tracking timeline DTO.
   */
  static trackOrderPublic(orderId, phoneLast4) {
    if (!orderId || !phoneLast4) {
      return ErrorService.createClientError(
        'Order ID and last 4 digits of your phone number are required.',
        ErrorService.CODES.INVALID_PARAMETERS
      );
    }

    const order = SheetService.findById(CONFIG.SHEETS.ORDERS, 'order_id', orderId);
    if (!order) {
      return ErrorService.createClientError('Order not found.', ErrorService.CODES.ORDER_NOT_FOUND);
    }

    const customer = SheetService.findById(CONFIG.SHEETS.CUSTOMERS, 'customer_id', order.customer_id);
    if (!customer || !customer.primary_phone.endsWith(String(phoneLast4).trim())) {
      return ErrorService.createClientError('Phone number does not match this order.', ErrorService.CODES.UNAUTHORIZED);
    }

    const statusLogs = SheetService.findByField(CONFIG.SHEETS.ORDER_STATUS_LOG, 'order_id', orderId);
    statusLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const seller = SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', order.seller_id);

    return {
      success: true,
      data: {
        order_id: order.order_id,
        current_status: order.current_status,
        total_amount_inr: parseFloat(order.total_amount_inr) || 0,
        seller_business_name: seller ? seller.business_name : 'Local Rice Merchant',
        seller_locality: seller ? seller.locality : 'Garia',
        status_timeline: statusLogs.map(l => ({
          status: l.to_status,
          timestamp: l.timestamp
        }))
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }
}
