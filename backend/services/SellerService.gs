/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - SellerService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Master Merchant Management, Onboarding, and Seller Dashboard Engine.
 * Manages seller registration, FSSAI verification, operating hours, delivery
 * coverage radius, merchant operational KPIs, and administrative KYC approvals.
 */

class SellerService {
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
        case 'submitSellerApplication':
          return this.submitApplication(payload);

        case 'getSellerDashboard':
          return this.getSellerDashboard(authToken);

        case 'updateStoreStatus':
          return this.updateStoreStatus(payload.is_open, authToken);

        case 'getPublicSellerProfile':
          return this.getPublicSellerProfile(payload.seller_id);

        case 'moderateSeller':
          return this.moderateSeller(
            payload.seller_id,
            payload.approval_status,
            payload.remarks,
            payload.commission_override_pct,
            authToken
          );

        default:
          return ErrorService.createClientError(
            'Unrecognized seller action: ' + action,
            ErrorService.CODES.INVALID_PARAMETERS
          );
      }
    } catch (err) {
      return ErrorService.handleException(err, 'SellerService.dispatch.' + action);
    }
  }

  /**
   * Onboarding: Submits new local rice merchant application.
   * Creates user authentication record and places merchant in PENDING_REVIEW.
   * @param {Object} formData - Form input fields.
   * @return {Object} API response envelope with created seller record.
   */
  static submitApplication(formData) {
    // 1. Validate mandatory fields
    const businessName = SecurityService.sanitizeText(formData.business_name, 120);
    const ownerName = SecurityService.sanitizeText(formData.owner_name, 100);
    const rawPhone = formData.contact_phone;
    const rawWhatsApp = formData.whatsapp_phone || rawPhone;
    const locality = SecurityService.sanitizeText(formData.locality, 100);
    const addressLine = SecurityService.sanitizeText(formData.address_line, 200);
    const pincode = String(formData.pincode || '').trim();

    if (!businessName || !ownerName || !locality || !addressLine) {
      return ErrorService.createClientError(
        'Please fill in all mandatory shop details (Shop name, Owner name, Locality, Address).',
        ErrorService.CODES.MISSING_REQUIRED_FIELD
      );
    }

    const cleanPhone = SecurityService.normalizeIndianPhone(rawPhone);
    const cleanWhatsApp = SecurityService.normalizeIndianPhone(rawWhatsApp);

    if (!cleanPhone) {
      return ErrorService.createClientError(
        'Please enter a valid 10-digit primary contact phone number.',
        ErrorService.CODES.INVALID_PHONE_NUMBER
      );
    }

    if (!cleanWhatsApp) {
      return ErrorService.createClientError(
        'Please enter a valid 10-digit WhatsApp order dispatch number.',
        ErrorService.CODES.INVALID_PHONE_NUMBER
      );
    }

    if (!SecurityService.isValidPincode(pincode)) {
      return ErrorService.createClientError(
        'Please enter a valid 6-digit postal PIN code in Kolkata / Garia region.',
        ErrorService.CODES.INVALID_PINCODE
      );
    }

    // 2. Validate or format FSSAI registration number if provided
    let fssaiNumber = SecurityService.sanitizeText(formData.fssai_number, 20);
    let fssaiVerified = false;
    if (fssaiNumber) {
      // Clean digits only
      fssaiNumber = fssaiNumber.replace(/\D/g, '');
      if (fssaiNumber.length === 14) {
        fssaiVerified = true; // Valid 14-digit FSSAI format; staged for admin confirmation
      }
    }

    // 3. Create or link user account in USERS table
    const email = formData.email ? String(formData.email).trim().toLowerCase() : '';
    const user = AuthService.getOrCreateUser(cleanPhone, CONFIG.ROLES.SELLER, email);

    // Guard: Prevent duplicate shop applications for the same user
    const existingSeller = SheetService.findByField(CONFIG.SHEETS.SELLERS, 'user_id', user.user_id);
    if (existingSeller && existingSeller.length > 0) {
      return ErrorService.createClientError(
        'A merchant account is already registered with this mobile number (Status: ' + existingSeller[0].approval_status + ').',
        ErrorService.CODES.DUPLICATE_ENTRY
      );
    }

    // 4. Construct Seller record matching Table 4 schema
    const nowIso = new Date().toISOString();
    const serviceRadius = SecurityService.sanitizeNumber(formData.service_radius_km, 1.0, 10.0, 3.0);
    const newSeller = {
      seller_id: SheetService.generateId('SLR'),
      user_id: user.user_id,
      business_name: businessName,
      owner_name: ownerName,
      contact_phone: cleanPhone,
      whatsapp_phone: cleanWhatsApp,
      email: email,
      address_line: addressLine,
      locality: locality,
      pincode: pincode,
      latitude: '',
      longitude: '',
      service_radius_km: serviceRadius,
      fssai_number: fssaiNumber,
      fssai_verified: fssaiVerified,
      operating_hours: JSON.stringify(formData.operating_hours || { open: '08:00', close: '21:00' }),
      is_open: true,
      rating_avg: 5.0,
      review_count: 0,
      approval_status: CONFIG.APPROVAL_STATUS.PENDING_REVIEW,
      commission_override_pct: '',
      created_at: nowIso,
      updated_at: nowIso
    };

    SheetService.insert(CONFIG.SHEETS.SELLERS, newSeller);

    return {
      success: true,
      data: {
        seller_id: newSeller.seller_id,
        business_name: newSeller.business_name,
        approval_status: newSeller.approval_status,
        message: 'Merchant application submitted successfully. Your shop will be verified by the marketplace team within 24 hours.'
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Merchant Portal: Fetches merchant operational dashboard data and KPIs.
   * Gated by authentication and IDOR merchant profile verification.
   * @param {string} authToken - Merchant session token.
   * @return {Object} Dashboard metrics, assigned orders, and catalog status.
   */
  static getSellerDashboard(authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    // Find linked merchant record
    const sellers = SheetService.findByField(CONFIG.SHEETS.SELLERS, 'user_id', auth.user.user_id);
    if (!sellers || sellers.length === 0) {
      return ErrorService.createClientError(
        'No merchant profile found for this user account. Please register your shop first.',
        ErrorService.CODES.SELLER_NOT_FOUND
      );
    }
    const seller = sellers[0];

    // If seller is not yet approved, return limited staging status
    if (seller.approval_status !== CONFIG.APPROVAL_STATUS.APPROVED) {
      return {
        success: true,
        data: {
          is_approved: false,
          approval_status: seller.approval_status,
          seller_id: seller.seller_id,
          business_name: seller.business_name,
          message: 'Your merchant application is currently ' + seller.approval_status + '. You will be notified once activated.'
        },
        error: null,
        code: null,
        timestamp: new Date().toISOString()
      };
    }

    // 1. Fetch all orders assigned to this seller
    const allOrders = SheetService.findByField(CONFIG.SHEETS.ORDERS, 'seller_id', seller.seller_id);

    // 2. Aggregate KPI metrics
    let pendingCount = 0;
    let readyCount = 0;
    let inTransitCount = 0;
    let completedCount = 0;
    let totalGrossSales = 0.0;
    let totalNetPayout = 0.0;

    const activeOrders = [];

    for (const order of allOrders) {
      const status = order.current_status;
      const subtotal = parseFloat(order.subtotal_inr) || 0;
      const payout = parseFloat(order.seller_payout_inr) || 0;

      if (status === CONFIG.ORDER_STATUS.PLACED || status === CONFIG.ORDER_STATUS.SELLER_NOTIFIED) {
        pendingCount++;
        activeOrders.push(order);
      } else if (status === CONFIG.ORDER_STATUS.SELLER_CONFIRMED || status === CONFIG.ORDER_STATUS.PACKING) {
        pendingCount++;
        activeOrders.push(order);
      } else if (status === CONFIG.ORDER_STATUS.READY_FOR_PICKUP || status === CONFIG.ORDER_STATUS.RIDER_ASSIGNED) {
        readyCount++;
        activeOrders.push(order);
      } else if (status === CONFIG.ORDER_STATUS.PICKED_UP || status === CONFIG.ORDER_STATUS.OUT_FOR_DELIVERY) {
        inTransitCount++;
        activeOrders.push(order);
      } else if (status === CONFIG.ORDER_STATUS.DELIVERED || status === CONFIG.ORDER_STATUS.COMPLETED) {
        completedCount++;
        totalGrossSales += subtotal;
        totalNetPayout += payout;
      }
    }

    // 3. Fetch seller's active product catalog
    const sellerProducts = SheetService.findByField(CONFIG.SHEETS.PRODUCTS, 'seller_id', seller.seller_id);

    return {
      success: true,
      data: {
        is_approved: true,
        profile: {
          seller_id: seller.seller_id,
          business_name: seller.business_name,
          owner_name: seller.owner_name,
          locality: seller.locality,
          address_line: seller.address_line,
          rating_avg: parseFloat(seller.rating_avg) || 5.0,
          review_count: parseInt(seller.review_count, 10) || 0,
          is_open: !!seller.is_open,
          fssai_verified: !!seller.fssai_verified
        },
        kpis: {
          pending_confirmation: pendingCount,
          ready_for_pickup: readyCount,
          in_transit: inTransitCount,
          completed_orders: completedCount,
          total_orders: allOrders.length,
          total_gross_sales_inr: Math.round(totalGrossSales * 100) / 100,
          total_net_payout_inr: Math.round(totalNetPayout * 100) / 100
        },
        active_orders: activeOrders,
        catalog: sellerProducts
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Merchant: Fast toggle for daily store opening/closing.
   * @param {boolean} isOpen - Shop open status.
   * @param {string} authToken - Merchant session token.
   * @return {Object} API response envelope.
   */
  static updateStoreStatus(isOpen, authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const sellers = SheetService.findByField(CONFIG.SHEETS.SELLERS, 'user_id', auth.user.user_id);
    if (!sellers || sellers.length === 0) {
      return ErrorService.createClientError('Merchant profile not found.', ErrorService.CODES.SELLER_NOT_FOUND);
    }
    const seller = sellers[0];

    const updated = SheetService.updateById(CONFIG.SHEETS.SELLERS, 'seller_id', seller.seller_id, {
      is_open: !!isOpen,
      updated_at: new Date().toISOString()
    });

    return {
      success: true,
      data: {
        seller_id: seller.seller_id,
        is_open: !!updated.is_open,
        message: 'Store status updated to ' + (isOpen ? 'OPEN' : 'CLOSED')
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Public: Retrieves public storefront bio, FSSAI verification, and active rice items.
   * Only approved sellers are accessible.
   * @param {string} sellerId - Canonical Seller ID.
   * @return {Object} API response envelope with public profile.
   */
  static getPublicSellerProfile(sellerId) {
    if (!sellerId) {
      return ErrorService.createClientError('Seller ID is required.', ErrorService.CODES.INVALID_PARAMETERS);
    }

    const seller = SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', sellerId);
    if (!seller || seller.approval_status !== CONFIG.APPROVAL_STATUS.APPROVED) {
      return ErrorService.createClientError('Rice seller not found or currently inactive.', ErrorService.CODES.SELLER_NOT_FOUND);
    }

    // Query active approved products for this seller
    const allProducts = SheetService.findByField(CONFIG.SHEETS.PRODUCTS, 'seller_id', sellerId);
    const activeProducts = allProducts.filter(
      p => p.approval_status === CONFIG.APPROVAL_STATUS.APPROVED && p.is_available === true
    );

    return {
      success: true,
      data: {
        seller_id: seller.seller_id,
        business_name: seller.business_name,
        locality: seller.locality,
        address_line: seller.address_line,
        rating_avg: parseFloat(seller.rating_avg) || 5.0,
        review_count: parseInt(seller.review_count, 10) || 0,
        service_radius_km: parseFloat(seller.service_radius_km) || 3.0,
        fssai_verified: !!seller.fssai_verified,
        fssai_number: seller.fssai_verified ? seller.fssai_number : '',
        is_open: !!seller.is_open,
        products: activeProducts
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Admin: KYC moderation of merchant applications.
   * Transitions status to APPROVED, REJECTED, or SUSPENDED.
   * @param {string} sellerId - Target Seller ID.
   * @param {string} approvalStatus - APPROVED, REJECTED, SUSPENDED.
   * @param {string} [remarks=''] - Admin notes.
   * @param {number|null} [commissionOverridePct=null] - Custom commission percentage.
   * @param {string} adminAuthToken - Admin session token.
   * @return {Object} API response envelope.
   */
  static moderateSeller(sellerId, approvalStatus, remarks = '', commissionOverridePct = null, adminAuthToken) {
    const auth = SecurityService.authorizeRequest(adminAuthToken, [CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError('Admin authorization required.', ErrorService.CODES.UNAUTHORIZED);
    }

    const seller = SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', sellerId);
    if (!seller) {
      return ErrorService.createClientError('Seller not found.', ErrorService.CODES.SELLER_NOT_FOUND);
    }

    const oldStatus = seller.approval_status;
    const updates = {
      approval_status: approvalStatus,
      updated_at: new Date().toISOString()
    };

    if (commissionOverridePct !== null && commissionOverridePct !== undefined && !isNaN(parseFloat(commissionOverridePct))) {
      updates.commission_override_pct = parseFloat(commissionOverridePct);
    }

    const updatedSeller = SheetService.updateById(CONFIG.SHEETS.SELLERS, 'seller_id', sellerId, updates);

    // Record admin moderation in AUDIT_LOG
    AuditService.logApprovalShift('SELLERS', sellerId, auth.user.user_id, oldStatus, approvalStatus, remarks);

    return {
      success: true,
      data: {
        seller_id: sellerId,
        business_name: updatedSeller.business_name,
        approval_status: updatedSeller.approval_status,
        message: 'Seller ' + updatedSeller.business_name + ' status updated to ' + approvalStatus
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }
}
