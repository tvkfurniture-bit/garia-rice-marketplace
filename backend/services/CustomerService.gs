/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - CustomerService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Master Customer Account, Address Book, and Order History Engine.
 * Manages customer registration, saved delivery addresses across Garia zones,
 * profile updating, and historical order tracking for verified buyers.
 */

class CustomerService {
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
        case 'getCustomerProfile':
          return this.getCustomerProfile(authToken);

        case 'updateCustomerProfile':
          return this.updateCustomerProfile(payload, authToken);

        case 'saveCustomerAddress':
          return this.saveDeliveryAddress(payload, authToken);

        case 'getCustomerAddresses':
          return this.getSavedAddresses(authToken);

        case 'getCustomerOrders':
          return this.getCustomerOrderHistory(authToken);

        default:
          return ErrorService.createClientError(
            'Unrecognized customer action: ' + action,
            ErrorService.CODES.INVALID_PARAMETERS
          );
      }
    } catch (err) {
      return ErrorService.handleException(err, 'CustomerService.dispatch.' + action);
    }
  }

  /**
   * Idempotently retrieves or creates a customer profile record linked to a user.
   * Called automatically during authentication or checkout.
   * @param {string} userId - User ID from USERS table.
   * @param {string} phone - Normalized 10-digit mobile number.
   * @param {string} [fullName='Valued Customer'] - Customer full name.
   * @param {string} [email=''] - Optional email address.
   * @return {Object} Record from CUSTOMERS table.
   */
  static getOrCreateCustomer(userId, phone, fullName = 'Valued Customer', email = '') {
    const existing = SheetService.findByField(CONFIG.SHEETS.CUSTOMERS, 'user_id', userId);
    if (existing && existing.length > 0) {
      return existing[0];
    }

    const nowIso = new Date().toISOString();
    const newCustomer = {
      customer_id: SheetService.generateId('CST'),
      user_id: userId,
      full_name: SecurityService.sanitizeText(fullName, 100) || 'Valued Customer',
      primary_phone: phone,
      whatsapp_phone: phone,
      saved_addresses: JSON.stringify([]),
      default_zone_id: 'ZONE-GARIA-01',
      total_orders: 0,
      created_at: nowIso,
      updated_at: nowIso
    };

    SheetService.insert(CONFIG.SHEETS.CUSTOMERS, newCustomer);
    return newCustomer;
  }

  /**
   * Retrieves profile details and saved addresses for the authenticated customer.
   * @param {string} authToken - Customer session token.
   * @return {Object} API response envelope with customer profile DTO.
   */
  static getCustomerProfile(authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.CUSTOMER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const customer = this.getOrCreateCustomer(auth.user.user_id, auth.user.phone);

    let addresses = [];
    try {
      addresses = customer.saved_addresses ? JSON.parse(customer.saved_addresses) : [];
    } catch (e) {
      addresses = [];
    }

    return {
      success: true,
      data: {
        customer_id: customer.customer_id,
        user_id: customer.user_id,
        full_name: customer.full_name,
        primary_phone: customer.primary_phone,
        whatsapp_phone: customer.whatsapp_phone,
        saved_addresses: addresses,
        total_orders: parseInt(customer.total_orders, 10) || 0
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Updates customer profile details (Full name and WhatsApp contact number).
   * @param {Object} payload - { full_name, whatsapp_phone }
   * @param {string} authToken - Customer session token.
   * @return {Object} API response envelope with updated profile.
   */
  static updateCustomerProfile(payload, authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.CUSTOMER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const customer = this.getOrCreateCustomer(auth.user.user_id, auth.user.phone);
    const updates = {};

    if (payload.full_name) {
      updates.full_name = SecurityService.sanitizeText(payload.full_name, 100);
    }

    if (payload.whatsapp_phone) {
      const cleanWa = SecurityService.normalizeIndianPhone(payload.whatsapp_phone);
      if (cleanWa) {
        updates.whatsapp_phone = cleanWa;
      }
    }

    updates.updated_at = new Date().toISOString();

    const updated = SheetService.updateById(
      CONFIG.SHEETS.CUSTOMERS,
      'customer_id',
      customer.customer_id,
      updates
    );

    return {
      success: true,
      data: {
        customer_id: updated.customer_id,
        full_name: updated.full_name,
        primary_phone: updated.primary_phone,
        whatsapp_phone: updated.whatsapp_phone,
        message: 'Profile updated successfully.'
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Saves or updates a delivery address in the customer's address book.
   * Validates mandatory street address, landmark, Garia locality, and PIN code.
   * @param {Object} addressData - { label, address_line, landmark, locality, pincode, is_default }
   * @param {string} authToken - Customer session token.
   * @return {Object} API response envelope with updated address list.
   */
  static saveDeliveryAddress(addressData, authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.CUSTOMER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const customer = this.getOrCreateCustomer(auth.user.user_id, auth.user.phone);

    const addressLine = SecurityService.sanitizeText(addressData.address_line, 200);
    const landmark = SecurityService.sanitizeText(addressData.landmark, 100);
    const locality = SecurityService.sanitizeText(addressData.locality, 100);
    const pincode = String(addressData.pincode || '').trim();
    const label = SecurityService.sanitizeText(addressData.label, 30) || 'Home';
    const isDefault = !!addressData.is_default;

    if (!addressLine || !locality) {
      return ErrorService.createClientError(
        'Address line and Locality are mandatory for delivery.',
        ErrorService.CODES.MISSING_REQUIRED_FIELD
      );
    }

    if (!SecurityService.isValidPincode(pincode)) {
      return ErrorService.createClientError(
        'Please enter a valid 6-digit postal PIN code.',
        ErrorService.CODES.INVALID_PINCODE
      );
    }

    // Parse existing address array
    let addresses = [];
    try {
      addresses = customer.saved_addresses ? JSON.parse(customer.saved_addresses) : [];
    } catch (e) {
      addresses = [];
    }

    // If marked default, unset default on other addresses
    if (isDefault) {
      addresses.forEach(a => a.is_default = false);
    }

    const addressId = addressData.address_id || ('ADDR-' + (addresses.length + 1));
    const existingIndex = addresses.findIndex(a => a.address_id === addressId);

    const newAddressObj = {
      address_id: addressId,
      label: label,
      address_line: addressLine,
      landmark: landmark,
      locality: locality,
      pincode: pincode,
      is_default: addresses.length === 0 ? true : isDefault
    };

    if (existingIndex >= 0) {
      addresses[existingIndex] = newAddressObj;
    } else {
      addresses.push(newAddressObj);
    }

    // Persist updated JSON array into CUSTOMERS table
    SheetService.updateById(
      CONFIG.SHEETS.CUSTOMERS,
      'customer_id',
      customer.customer_id,
      {
        saved_addresses: JSON.stringify(addresses),
        updated_at: new Date().toISOString()
      }
    );

    return {
      success: true,
      data: {
        saved_addresses: addresses,
        message: 'Delivery address saved successfully.'
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Retrieves saved delivery addresses for the authenticated customer.
   * @param {string} authToken - Customer session token.
   * @return {Object} API response envelope with addresses array.
   */
  static getSavedAddresses(authToken) {
    const profileResult = this.getCustomerProfile(authToken);
    if (!profileResult.success) {
      return profileResult;
    }

    return {
      success: true,
      data: {
        addresses: profileResult.data.saved_addresses || []
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Retrieves historical orders placed by this customer.
   * Enriches each order with the merchant's business name and locality.
   * @param {string} authToken - Customer session token.
   * @return {Object} API response envelope with enriched customer orders.
   */
  static getCustomerOrderHistory(authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.CUSTOMER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const customer = this.getOrCreateCustomer(auth.user.user_id, auth.user.phone);

    // Fetch orders placed by this customer
    const orders = SheetService.findByField(CONFIG.SHEETS.ORDERS, 'customer_id', customer.customer_id);

    // Build seller lookup map
    const allSellers = SheetService.getAll(CONFIG.SHEETS.SELLERS);
    const sellerMap = {};
    for (const seller of allSellers) {
      sellerMap[seller.seller_id] = seller;
    }

    // Enrich and sort orders newest first
    const enrichedOrders = orders.map(order => {
      const seller = sellerMap[order.seller_id];
      let address = {};
      try {
        address = typeof order.delivery_address === 'string'
          ? JSON.parse(order.delivery_address)
          : (order.delivery_address || {});
      } catch (e) {
        address = {};
      }

      return {
        order_id: order.order_id,
        current_status: order.current_status,
        subtotal_inr: parseFloat(order.subtotal_inr) || 0,
        delivery_fee_inr: parseFloat(order.delivery_fee_inr) || 0,
        total_amount_inr: parseFloat(order.total_amount_inr) || 0,
        total_weight_kg: parseFloat(order.total_weight_kg) || 0,
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        seller: {
          seller_id: order.seller_id,
          business_name: seller ? seller.business_name : 'Local Rice Merchant',
          locality: seller ? seller.locality : 'Garia'
        },
        delivery_address: address,
        created_at: order.created_at,
        updated_at: order.updated_at
      };
    });

    enrichedOrders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return {
      success: true,
      data: {
        customer_id: customer.customer_id,
        order_count: enrichedOrders.length,
        orders: enrichedOrders
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }
}
