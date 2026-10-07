/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - DeliveryService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Master Delivery Partner Management, Payload Matchmaking, and Transit Engine.
 * Enforces vehicle weight capacity constraints (Cycle: 25kg, Bike: 60kg, Toto: 250kg),
 * pre-claim customer privacy masking, atomic job claiming, and milestone transit tracking.
 */

class DeliveryService {
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
        case 'submitRiderApplication':
          return this.submitRiderApplication(payload);

        case 'getRiderJobs':
          return this.getAvailableJobs(authToken);

        case 'claimDeliveryJob':
          return this.claimDeliveryJob(payload.order_id, authToken);

        case 'updateDeliveryStatus':
          return this.updateTransitStatus(payload.order_id, payload.next_status, payload.remarks, authToken);

        case 'getRiderDashboard':
          return this.getRiderDashboard(authToken);

        case 'toggleRiderAvailability':
          return this.toggleRiderAvailability(payload.status, authToken);

        default:
          return ErrorService.createClientError(
            'Unrecognized delivery partner action: ' + action,
            ErrorService.CODES.INVALID_PARAMETERS
          );
      }
    } catch (err) {
      return ErrorService.handleException(err, 'DeliveryService.dispatch.' + action);
    }
  }

  /**
   * Onboarding: Submits new delivery partner registration.
   * Configures payload capacity according to vehicle type.
   * @param {Object} formData - Rider application fields.
   * @return {Object} API response envelope with created rider record.
   */
  static submitRiderApplication(formData) {
    const fullName = SecurityService.sanitizeText(formData.full_name, 100);
    const rawPhone = formData.phone;
    const vehicleType = String(formData.vehicle_type || 'CYCLE').toUpperCase();
    const serviceZones = formData.service_zones || ['ZONE-GARIA-01', 'ZONE-GARIA-02', 'ZONE-GARIA-03'];

    if (!fullName) {
      return ErrorService.createClientError('Full legal name is required.', ErrorService.CODES.MISSING_REQUIRED_FIELD);
    }

    const cleanPhone = SecurityService.normalizeIndianPhone(rawPhone);
    if (!cleanPhone) {
      return ErrorService.createClientError('Please enter a valid 10-digit mobile number.', ErrorService.CODES.INVALID_PHONE_NUMBER);
    }

    // Determine payload capacity by vehicle type
    const vehicleConfig = CONFIG.VEHICLE_TYPES[vehicleType] || CONFIG.VEHICLE_TYPES.CYCLE;
    const maxPayload = vehicleConfig.MAX_LOAD_KG;

    // Create linked user in USERS table
    const email = formData.email ? String(formData.email).trim().toLowerCase() : '';
    const user = AuthService.getOrCreateUser(cleanPhone, CONFIG.ROLES.RIDER, email);

    // Guard: Prevent duplicate registrations
    const existingRiders = SheetService.findByField(CONFIG.SHEETS.DELIVERY_PARTNERS, 'user_id', user.user_id);
    if (existingRiders && existingRiders.length > 0) {
      return ErrorService.createClientError(
        'A delivery partner account is already registered with this mobile number.',
        ErrorService.CODES.DUPLICATE_ENTRY
      );
    }

    const nowIso = new Date().toISOString();
    const newRider = {
      rider_id: SheetService.generateId('RDR'),
      user_id: user.user_id,
      full_name: fullName,
      phone: cleanPhone,
      vehicle_type: vehicleType,
      max_payload_kg: maxPayload,
      service_zones: JSON.stringify(serviceZones),
      current_status: 'AVAILABLE',
      verification_status: 'APPROVED', // Pre-approved for local testing; configurable to PENDING
      rating_avg: 5.0,
      total_deliveries: 0,
      created_at: nowIso,
      updated_at: nowIso
    };

    SheetService.insert(CONFIG.SHEETS.DELIVERY_PARTNERS, newRider);

    return {
      success: true,
      data: {
        rider_id: newRider.rider_id,
        full_name: newRider.full_name,
        vehicle_type: newRider.vehicle_type,
        max_payload_kg: newRider.max_payload_kg,
        message: 'Delivery partner registration successful! You can now view available delivery jobs.'
      },
      error: null,
      code: null,
      timestamp: nowIso
    };
  }

  /**
   * Matchmaking Dispatcher: Invoked by OrderService when order reaches READY_FOR_PICKUP.
   * Creates an open broadcast assignment record in DELIVERY_ASSIGNMENTS table.
   * @param {Object} order - Order record from ORDERS table.
   */
  static dispatchOrderToRiders(order) {
    try {
      const orderId = order.order_id;
      const riderPayout = parseFloat(order.rider_payout_inr) || 20.0;
      const nowIso = new Date().toISOString();

      // Check if assignment already exists
      const existing = SheetService.findByField(CONFIG.SHEETS.DELIVERY_ASSIGNMENTS, 'order_id', orderId);
      if (existing && existing.length > 0) {
        return; // Already dispatched
      }

      const assignmentRecord = {
        assignment_id: SheetService.generateId('ASN'),
        order_id: orderId,
        rider_id: '',
        assignment_status: 'DISPATCHED',
        dispatched_at: nowIso,
        accepted_at: '',
        picked_up_at: '',
        delivered_at: '',
        payout_inr: riderPayout
      };

      SheetService.insert(CONFIG.SHEETS.DELIVERY_ASSIGNMENTS, assignmentRecord);

    } catch (err) {
      Logger.log('[DeliveryService.dispatchOrderToRiders] Error: ' + err.message);
    }
  }

  /**
   * Available Jobs Pool for authenticated riders.
   * Enforces weight capacity matchmaking and customer privacy masking.
   * @param {string} authToken - Rider session token.
   * @return {Object} Available delivery jobs list.
   */
  static getAvailableJobs(authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    // Resolve rider profile
    const riders = SheetService.findByField(CONFIG.SHEETS.DELIVERY_PARTNERS, 'user_id', auth.user.user_id);
    if (!riders || riders.length === 0) {
      return ErrorService.createClientError('No delivery partner profile found.', ErrorService.CODES.RIDER_NOT_FOUND);
    }
    const rider = riders[0];

    const maxCapacity = parseFloat(rider.max_payload_kg) || 25.0;

    // Fetch all orders currently waiting for pickup
    const allOrders = SheetService.getAll(CONFIG.SHEETS.ORDERS);
    const candidateOrders = allOrders.filter(
      o => o.current_status === CONFIG.ORDER_STATUS.READY_FOR_PICKUP || o.current_status === CONFIG.ORDER_STATUS.RIDER_ASSIGNED
    );

    // Build seller lookup map
    const allSellers = SheetService.getAll(CONFIG.SHEETS.SELLERS);
    const sellerMap = {};
    for (const seller of allSellers) {
      sellerMap[seller.seller_id] = seller;
    }

    // Filter jobs matching vehicle capacity
    const availableJobs = [];

    for (const order of candidateOrders) {
      const orderWeight = parseFloat(order.total_weight_kg) || 0;

      // Weight Capacity Rule: Order weight must not exceed vehicle safe capacity
      if (orderWeight <= maxCapacity) {
        const seller = sellerMap[order.seller_id];

        // PRIVACY MASKING: Do not leak customer phone number or street address before acceptance
        availableJobs.push({
          order_id: order.order_id,
          total_weight_kg: orderWeight,
          approx_distance_km: parseFloat(order.approx_distance_km) || 0,
          rider_payout_inr: parseFloat(order.rider_payout_inr) || 25.0,
          pickup_seller_name: seller ? seller.business_name : 'Local Rice Merchant',
          pickup_locality: seller ? seller.locality : 'Garia Station',
          drop_locality: order.delivery_locality || 'Garia',
          can_carry: true,
          created_at: order.created_at
        });
      }
    }

    return {
      success: true,
      data: {
        rider_id: rider.rider_id,
        vehicle_type: rider.vehicle_type,
        max_payload_kg: maxCapacity,
        job_count: availableJobs.length,
        jobs: availableJobs
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Atomic Job Claiming Engine.
   * Race-condition safe: ensures only one rider can claim an open order.
   * @param {string} orderId - Canonical Order ID.
   * @param {string} authToken - Rider session token.
   * @return {Object} Claim result with full pickup and drop details unlocked.
   */
  static claimDeliveryJob(orderId, authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const riders = SheetService.findByField(CONFIG.SHEETS.DELIVERY_PARTNERS, 'user_id', auth.user.user_id);
    if (!riders || riders.length === 0) {
      return ErrorService.createClientError('Rider profile not found.', ErrorService.CODES.RIDER_NOT_FOUND);
    }
    const rider = riders[0];

    return SheetService.withLock(() => {
      const order = SheetService.findById(CONFIG.SHEETS.ORDERS, 'order_id', orderId);
      if (!order) {
        return ErrorService.createClientError('Order not found.', ErrorService.CODES.ORDER_NOT_FOUND);
      }

      // Verify order is available to be claimed
      const validStatuses = [CONFIG.ORDER_STATUS.READY_FOR_PICKUP, CONFIG.ORDER_STATUS.RIDER_ASSIGNED];
      if (!validStatuses.includes(order.current_status)) {
        return ErrorService.createClientError(
          'This delivery has already been claimed by another rider or is not ready for pickup.',
          ErrorService.CODES.ORDER_INVALID_STATE
        );
      }

      // Check payload capacity constraint
      const orderWeight = parseFloat(order.total_weight_kg) || 0;
      const riderCapacity = parseFloat(rider.max_payload_kg) || 25.0;
      if (orderWeight > riderCapacity) {
        return ErrorService.createClientError(
          'Order weight (' + orderWeight + ' kg) exceeds your vehicle safe capacity (' + riderCapacity + ' kg).',
          ErrorService.CODES.RIDER_CAPACITY_EXCEEDED
        );
      }

      const nowIso = new Date().toISOString();

      // 1. Update or create assignment record
      const assignments = SheetService.findByField(CONFIG.SHEETS.DELIVERY_ASSIGNMENTS, 'order_id', orderId);
      if (assignments && assignments.length > 0) {
        SheetService.updateById(
          CONFIG.SHEETS.DELIVERY_ASSIGNMENTS,
          'assignment_id',
          assignments[0].assignment_id,
          {
            rider_id: rider.rider_id,
            assignment_status: 'ACCEPTED',
            accepted_at: nowIso
          }
        );
      } else {
        SheetService.insert(CONFIG.SHEETS.DELIVERY_ASSIGNMENTS, {
          assignment_id: SheetService.generateId('ASN'),
          order_id: orderId,
          rider_id: rider.rider_id,
          assignment_status: 'ACCEPTED',
          dispatched_at: nowIso,
          accepted_at: nowIso,
          picked_up_at: '',
          delivered_at: '',
          payout_inr: parseFloat(order.rider_payout_inr) || 25.0
        });
      }

      // 2. Set rider status to BUSY
      SheetService.updateById(CONFIG.SHEETS.DELIVERY_PARTNERS, 'rider_id', rider.rider_id, {
        current_status: 'BUSY',
        updated_at: nowIso
      });

      // 3. Transition order status in state machine
      OrderService.transitionOrderStatus(
        orderId,
        CONFIG.ORDER_STATUS.RIDER_ACCEPTED,
        'Claimed by rider: ' + rider.full_name,
        rider.rider_id,
        CONFIG.ROLES.RIDER
      );

      // 4. Return unlocked customer address and seller pickup details
      const seller = SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', order.seller_id);
      let customerAddress = {};
      try {
        customerAddress = typeof order.delivery_address === 'string'
          ? JSON.parse(order.delivery_address)
          : (order.delivery_address || {});
      } catch (e) {
        customerAddress = {};
      }

      const customer = SheetService.findById(CONFIG.SHEETS.CUSTOMERS, 'customer_id', order.customer_id);

      return {
        success: true,
        data: {
          order_id: orderId,
          status: CONFIG.ORDER_STATUS.RIDER_ACCEPTED,
          rider_payout_inr: parseFloat(order.rider_payout_inr) || 25.0,
          total_weight_kg: orderWeight,
          pickup: {
            shop_name: seller ? seller.business_name : 'Rice Merchant',
            address: seller ? seller.address_line : 'Garia',
            locality: seller ? seller.locality : 'Garia Station',
            phone: seller ? seller.contact_phone : ''
          },
          drop: {
            customer_name: customer ? customer.full_name : 'Customer',
            customer_phone: customer ? customer.primary_phone : '',
            address_line: customerAddress.address_line || '',
            landmark: customerAddress.landmark || '',
            locality: customerAddress.locality || order.delivery_locality,
            pincode: customerAddress.pincode || ''
          },
          payment: {
            method: order.payment_method,
            collect_cash_inr: order.payment_method === CONFIG.PAYMENT_METHODS.COD ? parseFloat(order.total_amount_inr) : 0.0
          },
          message: 'Job claimed successfully! Customer delivery address is now unlocked.'
        },
        error: null,
        code: null,
        timestamp: nowIso
      };
    });
  }

  /**
   * Transit Milestone Updater.
   * Transitions orders across transit states: PICKED_UP, OUT_FOR_DELIVERY, DELIVERED.
   * @param {string} orderId - Canonical Order ID.
   * @param {string} nextStatus - Destination status.
   * @param {string} [remarks=''] - Optional notes.
   * @param {string} authToken - Rider session token.
   * @return {Object} API response envelope.
   */
  static updateTransitStatus(orderId, nextStatus, remarks = '', authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const riders = SheetService.findByField(CONFIG.SHEETS.DELIVERY_PARTNERS, 'user_id', auth.user.user_id);
    if (!riders || riders.length === 0) {
      return ErrorService.createClientError('Rider profile not found.', ErrorService.CODES.RIDER_NOT_FOUND);
    }
    const rider = riders[0];

    return SheetService.withLock(() => {
      const order = SheetService.findById(CONFIG.SHEETS.ORDERS, 'order_id', orderId);
      if (!order) {
        return ErrorService.createClientError('Order not found.', ErrorService.CODES.ORDER_NOT_FOUND);
      }

      // Verify this rider is assigned to this order
      const assignments = SheetService.findByField(CONFIG.SHEETS.DELIVERY_ASSIGNMENTS, 'order_id', orderId);
      if (!assignments || assignments.length === 0 || assignments[0].rider_id !== rider.rider_id) {
        return ErrorService.createClientError('Unauthorized: You are not assigned to this delivery.', ErrorService.CODES.UNAUTHORIZED);
      }

      const nowIso = new Date().toISOString();

      // Transition order status
      OrderService.transitionOrderStatus(orderId, nextStatus, remarks, rider.rider_id, CONFIG.ROLES.RIDER);

      // Update assignment timestamps
      const updateData = {};
      if (nextStatus === CONFIG.ORDER_STATUS.PICKED_UP) {
        updateData.picked_up_at = nowIso;
      } else if (nextStatus === CONFIG.ORDER_STATUS.DELIVERED) {
        updateData.delivered_at = nowIso;
        updateData.assignment_status = 'COMPLETED';

        // Reconcile delivery partner: increment total deliveries and set status to AVAILABLE
        const updatedCount = (parseInt(rider.total_deliveries, 10) || 0) + 1;
        SheetService.updateById(CONFIG.SHEETS.DELIVERY_PARTNERS, 'rider_id', rider.rider_id, {
          total_deliveries: updatedCount,
          current_status: 'AVAILABLE',
          updated_at: nowIso
        });

        // Mark payment collected if COD
        if (order.payment_method === CONFIG.PAYMENT_METHODS.COD) {
          SheetService.updateById(CONFIG.SHEETS.ORDERS, 'order_id', orderId, {
            payment_status: CONFIG.PAYMENT_STATUS.COLLECTED,
            updated_at: nowIso
          });
        }
      }

      if (Object.keys(updateData).length > 0) {
        SheetService.updateById(CONFIG.SHEETS.DELIVERY_ASSIGNMENTS, 'assignment_id', assignments[0].assignment_id, updateData);
      }

      return {
        success: true,
        data: {
          order_id: orderId,
          status: nextStatus,
          message: 'Delivery milestone updated to ' + nextStatus
        },
        error: null,
        code: null,
        timestamp: nowIso
      };
    });
  }

  /**
   * Rider Portal: Fetches active job, daily earnings, and lifetime stats.
   * @param {string} authToken - Rider session token.
   * @return {Object} Rider dashboard DTO.
   */
  static getRiderDashboard(authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const riders = SheetService.findByField(CONFIG.SHEETS.DELIVERY_PARTNERS, 'user_id', auth.user.user_id);
    if (!riders || riders.length === 0) {
      return ErrorService.createClientError('Rider profile not found.', ErrorService.CODES.RIDER_NOT_FOUND);
    }
    const rider = riders[0];

    // Find active assignment
    const allAssignments = SheetService.findByField(CONFIG.SHEETS.DELIVERY_ASSIGNMENTS, 'rider_id', rider.rider_id);
    let activeJob = null;
    let totalEarnings = 0.0;

    for (const asn of allAssignments) {
      const payout = parseFloat(asn.payout_inr) || 0;
      if (asn.assignment_status === 'COMPLETED') {
        totalEarnings += payout;
      } else if (asn.assignment_status === 'ACCEPTED') {
        const order = SheetService.findById(CONFIG.SHEETS.ORDERS, 'order_id', asn.order_id);
        const seller = order ? SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', order.seller_id) : null;
        let customerAddress = {};
        try {
          customerAddress = order && typeof order.delivery_address === 'string'
            ? JSON.parse(order.delivery_address)
            : (order ? order.delivery_address : {});
        } catch (e) {
          customerAddress = {};
        }

        activeJob = {
          order_id: asn.order_id,
          current_status: order ? order.current_status : 'RIDER_ACCEPTED',
          payout_inr: payout,
          total_weight_kg: order ? parseFloat(order.total_weight_kg) : 25,
          pickup: {
            shop_name: seller ? seller.business_name : 'Merchant',
            address: seller ? seller.address_line : 'Garia',
            phone: seller ? seller.contact_phone : ''
          },
          drop: {
            address_line: customerAddress.address_line || '',
            landmark: customerAddress.landmark || '',
            locality: customerAddress.locality || ''
          },
          payment: {
            method: order ? order.payment_method : 'COD',
            collect_cash_inr: (order && order.payment_method === CONFIG.PAYMENT_METHODS.COD) ? parseFloat(order.total_amount_inr) : 0
          }
        };
      }
    }

    return {
      success: true,
      data: {
        profile: {
          rider_id: rider.rider_id,
          full_name: rider.full_name,
          phone: rider.phone,
          vehicle_type: rider.vehicle_type,
          max_payload_kg: parseFloat(rider.max_payload_kg),
          current_status: rider.current_status,
          rating_avg: parseFloat(rider.rating_avg) || 5.0,
          total_deliveries: parseInt(rider.total_deliveries, 10) || 0,
          total_earnings_inr: Math.round(totalEarnings * 100) / 100
        },
        active_job: activeJob
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Toggles rider availability between AVAILABLE and OFFLINE.
   * @param {string} status - 'AVAILABLE' or 'OFFLINE'.
   * @param {string} authToken - Rider session token.
   * @return {Object} API response envelope.
   */
  static toggleRiderAvailability(status, authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.RIDER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const riders = SheetService.findByField(CONFIG.SHEETS.DELIVERY_PARTNERS, 'user_id', auth.user.user_id);
    if (!riders || riders.length === 0) {
      return ErrorService.createClientError('Rider profile not found.', ErrorService.CODES.RIDER_NOT_FOUND);
    }
    const rider = riders[0];

    const validStatus = (String(status).toUpperCase() === 'OFFLINE') ? 'OFFLINE' : 'AVAILABLE';
    SheetService.updateById(CONFIG.SHEETS.DELIVERY_PARTNERS, 'rider_id', rider.rider_id, {
      current_status: validStatus,
      updated_at: new Date().toISOString()
    });

    return {
      success: true,
      data: {
        current_status: validStatus,
        message: 'Status updated to ' + validStatus
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }
}
