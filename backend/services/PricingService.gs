/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - PricingService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Master Pricing, Delivery Slabs, and Marketplace Commission Engine.
 * Enforces zero-client-trust pricing, weight surcharges for bulky rice bags,
 * and deterministic mathematical reconciliation across all transactions.
 */

class PricingService {
  /**
   * Master RPC dispatcher for pricing calculations invoked from Code.gs
   * @param {string} action - API action name.
   * @param {Object} payload - Input payload.
   * @param {string} [authToken] - Session token (optional).
   * @return {Object} Standardized API response envelope.
   */
  static dispatch(action, payload = {}, authToken = null) {
    try {
      switch (action) {
        case 'calculateDeliveryEstimate':
          return this.getDeliveryEstimateRpc(payload);

        case 'getPricingBreakdown':
          return this.getPricingBreakdownRpc(payload);

        default:
          return ErrorService.createClientError(
            'Unrecognized pricing action: ' + action,
            ErrorService.CODES.INVALID_PARAMETERS
          );
      }
    } catch (err) {
      return ErrorService.handleException(err, 'PricingService.dispatch.' + action);
    }
  }

  /**
   * Rounds a numerical monetary value to exactly two decimal places.
   * @param {number} amount - Monetary amount in INR.
   * @return {number} Rounded currency value.
   */
  static roundCurrency(amount) {
    const num = parseFloat(amount) || 0;
    return Math.round(num * 100) / 100;
  }

  /**
   * Approximates delivery distance within Garia and contiguous zones.
   * If exact GPS coordinates are unavailable, uses centroid distance between localities.
   * Explicitly designated as "Approx. distance" for complete customer transparency.
   * @param {string} sellerLocality - Merchant locality (e.g., 'Garia Station').
   * @param {string} customerLocality - Customer delivery locality (e.g., 'Patuli').
   * @param {string} [customerPincode=''] - Customer 6-digit postal PIN.
   * @return {number} Approximate distance in kilometers.
   */
  static calculateApproxDistance(sellerLocality, customerLocality, customerPincode = '') {
    const cleanSeller = String(sellerLocality || '').trim().toLowerCase();
    const cleanCustomer = String(customerLocality || '').trim().toLowerCase();

    // Identical locality: base proximity
    if (cleanSeller && cleanCustomer && cleanSeller === cleanCustomer) {
      return 0.8;
    }

    // Hyperlocal Garia distance approximation matrix (km)
    const proximityMatrix = {
      'garia station': { 'patuli': 2.2, 'mahamayatala': 1.8, 'naktala': 2.5, 'kamalgazi': 3.5, 'boral': 4.0 },
      'patuli': { 'garia station': 2.2, 'mahamayatala': 3.0, 'naktala': 2.8, 'kamalgazi': 4.5, 'boral': 5.0 },
      'mahamayatala': { 'garia station': 1.8, 'patuli': 3.0, 'naktala': 3.2, 'kamalgazi': 2.0, 'boral': 2.8 },
      'naktala': { 'garia station': 2.5, 'patuli': 2.8, 'mahamayatala': 3.2, 'kamalgazi': 5.0, 'boral': 5.5 },
      'kamalgazi': { 'garia station': 3.5, 'patuli': 4.5, 'mahamayatala': 2.0, 'naktala': 5.0, 'boral': 3.0 },
      'boral': { 'garia station': 4.0, 'patuli': 5.0, 'mahamayatala': 2.8, 'naktala': 5.5, 'kamalgazi': 3.0 }
    };

    // Find best match in proximity matrix
    for (const [sellerKey, targets] of Object.entries(proximityMatrix)) {
      if (cleanSeller.includes(sellerKey)) {
        for (const [targetKey, distKm] of Object.entries(targets)) {
          if (cleanCustomer.includes(targetKey)) {
            return distKm;
          }
        }
      }
    }

    // Default approximation for contiguous Garia zone if not in explicit matrix
    return 2.5;
  }

  /**
   * Calculates transparent delivery fee based on distance slabs and weight surcharges.
   * Formula:
   * Base Fee = Slab Fee (e.g. ₹25 for first 2.0 km) + (Excess Dist * ₹10/km)
   * Weight Surcharge = Max(0, Total Weight - 25kg) * ₹1.50/kg
   * @param {number} distanceKm - Calculated distance in km.
   * @param {number} totalWeightKg - Aggregate order weight in kg.
   * @return {Object} { deliveryFee, baseFee, surchargeFee, isSurchargeApplied }
   */
  static calculateDeliveryFee(distanceKm, totalWeightKg) {
    const dist = Math.max(0.1, parseFloat(distanceKm) || 1.0);
    const weight = Math.max(0.0, parseFloat(totalWeightKg) || 0.0);

    const baseRadius = CONFIG.DEFAULTS.BASE_DELIVERY_RADIUS_KM || 2.0;
    const baseFee = CONFIG.DEFAULTS.BASE_DELIVERY_FEE_INR || 25.0;
    const excessDistRate = CONFIG.DEFAULTS.EXCESS_DISTANCE_PER_KM_INR || 10.0;
    const weightThreshold = CONFIG.DEFAULTS.WEIGHT_THRESHOLD_KG || 25.0;
    const excessWeightRate = CONFIG.DEFAULTS.EXCESS_WEIGHT_PER_KG_INR || 1.5;

    // 1. Distance Calculation
    let distanceFee = baseFee;
    if (dist > baseRadius) {
      const excessDist = dist - baseRadius;
      distanceFee += excessDist * excessDistRate;
    }

    // 2. Bulky Weight Surcharge Calculation (handles 26kg, 50kg, or multi-bag orders)
    let weightSurcharge = 0.0;
    if (weight > weightThreshold) {
      const excessWeight = weight - weightThreshold;
      weightSurcharge = excessWeight * excessWeightRate;
    }

    const totalDeliveryFee = this.roundCurrency(distanceFee + weightSurcharge);

    return {
      totalDeliveryFee: totalDeliveryFee,
      baseDistanceFee: this.roundCurrency(distanceFee),
      weightSurcharge: this.roundCurrency(weightSurcharge),
      isWeightSurchargeApplied: weightSurcharge > 0
    };
  }

  /**
   * Calculates platform commission amount from rice subtotal.
   * Uses seller override percentage if set, otherwise uses admin-configured default.
   * @param {number} subtotalInr - Rice subtotal in INR.
   * @param {number|null} [sellerOverridePct=null] - Optional merchant override percentage.
   * @return {Object} { commissionInr, commissionRatePct }
   */
  static calculateCommission(subtotalInr, sellerOverridePct = null) {
    const subtotal = Math.max(0, parseFloat(subtotalInr) || 0);

    let effectiveRate = AppConfig.getCommissionPercent();
    if (sellerOverridePct !== null && sellerOverridePct !== undefined && !isNaN(parseFloat(sellerOverridePct))) {
      effectiveRate = parseFloat(sellerOverridePct);
    }

    const commissionAmount = this.roundCurrency(subtotal * (effectiveRate / 100));

    return {
      commissionInr: commissionAmount,
      commissionRatePct: effectiveRate
    };
  }

  /**
   * Master Pricing Breakdown Engine.
   * Evaluates order items directly against the database PRODUCTS table to guarantee
   * zero price manipulation by client-side JavaScript.
   * @param {Object[]} items - Array of { product_id, quantity }.
   * @param {string} sellerId - Owning merchant ID.
   * @param {Object} deliveryAddress - { locality, pincode, address_line }.
   * @return {Object} Comprehensive verified pricing breakdown DTO.
   */
  static calculateOrderPricing(items, sellerId, deliveryAddress = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Order items list cannot be empty.');
    }

    if (!sellerId) {
      throw new Error('Seller ID must be specified for pricing breakdown.');
    }

    // 1. Resolve seller profile for locality and commission override
    const seller = SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', sellerId);
    if (!seller) {
      throw new Error('Designated seller [' + sellerId + '] does not exist.');
    }

    // 2. Fetch and verify each item from the PRODUCTS table
    let verifiedSubtotal = 0.0;
    let verifiedTotalWeight = 0.0;
    const verifiedItems = [];

    for (const item of items) {
      const productId = item.product_id;
      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);

      const product = SheetService.findById(CONFIG.SHEETS.PRODUCTS, 'product_id', productId);
      if (!product) {
        throw new Error('Product [' + productId + '] does not exist in catalog.');
      }

      // Enforce single-seller constraint
      if (String(product.seller_id).trim() !== String(sellerId).trim()) {
        throw new Error('All products in cart must belong to the same seller: ' + seller.business_name);
      }

      // Enforce availability
      if (product.stock_status === CONFIG.STOCK_STATUS.OUT_OF_STOCK || product.is_available === false) {
        throw new Error('Product [' + product.name_en + '] is currently out of stock.');
      }

      const unitPrice = parseFloat(product.price_inr) || 0.0;
      const packWeight = parseFloat(product.pack_size_kg) || 0.0;
      const lineTotal = this.roundCurrency(unitPrice * quantity);

      verifiedSubtotal += lineTotal;
      verifiedTotalWeight += (packWeight * quantity);

      verifiedItems.push({
        product_id: product.product_id,
        name: product.name_en,
        variety: product.variety,
        brand: product.brand,
        pack_size_kg: packWeight,
        unit_price_inr: unitPrice,
        quantity: quantity,
        line_total_inr: lineTotal
      });
    }

    verifiedSubtotal = this.roundCurrency(verifiedSubtotal);
    verifiedTotalWeight = Math.round(verifiedTotalWeight * 10) / 10;

    // 3. Compute Distance & Delivery Fee
    const customerLocality = deliveryAddress.locality || '';
    const customerPincode = deliveryAddress.pincode || '';
    const approxDistKm = this.calculateApproxDistance(seller.locality, customerLocality, customerPincode);
    const deliveryFeeResult = this.calculateDeliveryFee(approxDistKm, verifiedTotalWeight);
    const deliveryFee = deliveryFeeResult.totalDeliveryFee;

    // 4. Compute Platform Commission & Payouts
    const commissionResult = this.calculateCommission(verifiedSubtotal, seller.commission_override_pct);
    const commissionInr = commissionResult.commissionInr;
    const sellerPayout = this.roundCurrency(verifiedSubtotal - commissionInr);

    // 5. Compute Delivery Rider Compensation (80% default)
    const riderCutPct = CONFIG.DEFAULTS.RIDER_PAYOUT_SHARE_PCT || 80.0;
    const riderPayout = this.roundCurrency(deliveryFee * (riderCutPct / 100));
    const deliveryMargin = this.roundCurrency(deliveryFee - riderPayout);

    // 6. Total Payable (Mathematical Invariant: Subtotal + Delivery)
    const totalAmount = this.roundCurrency(verifiedSubtotal + deliveryFee);
    const totalMarketplaceContribution = this.roundCurrency(commissionInr + deliveryMargin);

    return {
      seller_id: sellerId,
      seller_business_name: seller.business_name,
      seller_locality: seller.locality,
      subtotal_inr: verifiedSubtotal,
      total_weight_kg: verifiedTotalWeight,
      approx_distance_km: approxDistKm,
      delivery_fee_inr: deliveryFee,
      delivery_fee_breakdown: deliveryFeeResult,
      platform_fee_inr: 0.0,
      total_amount_inr: totalAmount,
      commission_pct: commissionResult.commissionRatePct,
      commission_inr: commissionInr,
      seller_payout_inr: sellerPayout,
      rider_payout_inr: riderPayout,
      marketplace_contribution_inr: totalMarketplaceContribution,
      items: verifiedItems
    };
  }

  /**
   * Helper for RPC estimate endpoint.
   * @private
   */
  static getDeliveryEstimateRpc(payload) {
    const sellerId = payload.seller_id;
    const locality = payload.customer_locality || '';
    const pincode = payload.customer_pincode || '';
    const weightKg = parseFloat(payload.total_weight_kg) || 25.0;

    let sellerLocality = 'Garia Station';
    if (sellerId) {
      const seller = SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', sellerId);
      if (seller) {
        sellerLocality = seller.locality;
      }
    }

    const distKm = this.calculateApproxDistance(sellerLocality, locality, pincode);
    const feeResult = this.calculateDeliveryFee(distKm, weightKg);

    return {
      success: true,
      data: {
        approx_distance_km: distKm,
        delivery_fee_inr: feeResult.totalDeliveryFee,
        base_fee_inr: feeResult.baseDistanceFee,
        weight_surcharge_inr: feeResult.weightSurcharge,
        is_surcharge_applied: feeResult.isWeightSurchargeApplied
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Helper for RPC pricing breakdown endpoint.
   * @private
   */
  static getPricingBreakdownRpc(payload) {
    const items = payload.items || [];
    const sellerId = payload.seller_id;
    const address = payload.delivery_address || {};

    if (!items.length || !sellerId) {
      return ErrorService.createClientError(
        'Both items array and seller_id are required.',
        ErrorService.CODES.INVALID_PARAMETERS
      );
    }

    const breakdown = this.calculateOrderPricing(items, sellerId, address);

    return {
      success: true,
      data: breakdown,
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }
}
