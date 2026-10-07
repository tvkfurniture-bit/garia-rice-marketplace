/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - ProductService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Master Product Catalog, Bilingual Search, and Multi-Seller Comparison Engine.
 * Implements tokenized search (English & Bengali), side-by-side delivered value
 * ranking, single-seller comparison trays, and merchant inventory management.
 */

class ProductService {
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
        case 'getPublicCatalog':
          return this.getPublicCatalog(payload);

        case 'getProductDetails':
          return this.getProductDetails(payload.product_id, payload.customer_locality);

        case 'getSellerComparison':
          return this.getSellerComparison(payload.variety, payload.pack_size_kg, payload.customer_locality);

        case 'searchProducts':
          return this.searchProducts(payload.query, payload.customer_locality, payload.pack_size);

        case 'submitProduct':
          return this.submitProduct(payload, authToken);

        case 'updateProductAvailability':
        case 'updateProductPrice':
          return this.updatePriceStock(
            payload.product_id,
            payload.price_inr,
            payload.stock_status,
            payload.is_available,
            authToken
          );

        case 'moderateProduct':
          return this.moderateProduct(payload.product_id, payload.approval_status, payload.notes, authToken);

        default:
          return ErrorService.createClientError(
            'Unrecognized product action: ' + action,
            ErrorService.CODES.INVALID_PARAMETERS
          );
      }
    } catch (err) {
      return ErrorService.handleException(err, 'ProductService.dispatch.' + action);
    }
  }

  /**
   * Bilingual keyword translation dictionary (English <-> Bengali Script).
   * Ensures customers searching in either language discover matching rice varieties.
   */
  static get BILINGUAL_SYNONYMS() {
    return {
      'miniket': ['মিনিকেট', 'মিনিকিট', 'miniket', 'minikit'],
      'gobindobhog': ['গোবিন্দভোগ', 'gobindobhog', 'gobindobhog rice'],
      'ratna': ['রত্না', 'ratna', 'sharna', 'swarna'],
      'swarna': ['স্বর্ণা', 'swarna', 'shorna'],
      'banskathi': ['বাঁশকাঠি', 'বাসকাঠি', 'banskathi', 'baskathi'],
      'dudheshwar': ['দুধেশ্বর', 'dudheswar', 'dudheshwar'],
      'basmati': ['বাসমতী', 'দেরাদুন বাসমতী', 'basmati', 'dehradun'],
      'parboiled': ['সিদ্ধ', 'সেদ্ধ', 'parboiled', 'sidhdho'],
      'raw': ['আতপ', 'atap', 'raw']
    };
  }

  /**
   * Normalizes search tokens and expands synonyms across Bengali and English.
   * @param {string} query - Raw search query string.
   * @return {string[]} Array of normalized query tokens.
   */
  static expandSearchTokens(query) {
    if (!query || typeof query !== 'string') {
      return [];
    }

    const clean = query.trim().toLowerCase();
    const rawTokens = clean.split(/\s+/).filter(t => t.length > 0);
    const expanded = new Set(rawTokens);

    for (const token of rawTokens) {
      for (const [key, synonyms] of Object.entries(this.BILINGUAL_SYNONYMS)) {
        if (key.includes(token) || synonyms.some(s => s.toLowerCase().includes(token))) {
          expanded.add(key);
          synonyms.forEach(s => expanded.add(s.toLowerCase()));
        }
      }
    }

    return Array.from(expanded);
  }

  /**
   * Reads all approved sellers into an in-memory lookup map.
   * Key: seller_id, Value: Seller Object.
   * @private
   */
  static getApprovedSellersMap_() {
    const allSellers = SheetService.getAll(CONFIG.SHEETS.SELLERS);
    const sellerMap = {};
    for (const seller of allSellers) {
      if (seller.approval_status === CONFIG.APPROVAL_STATUS.APPROVED) {
        sellerMap[seller.seller_id] = seller;
      }
    }
    return sellerMap;
  }

  /**
   * Retrieves public catalog of approved rice products joined with seller details.
   * @param {Object} [filters={}] - Optional filters: { variety, brand, pack_size, grain_type, max_price, customer_locality }.
   * @param {string} [sort='BEST_VALUE'] - Sort mode: 'BEST_VALUE', 'PRICE_ASC', 'RATING_DESC', 'NEAREST'.
   * @param {number} [limit=20] - Max products to return.
   * @param {number} [offset=0] - Pagination offset.
   * @return {Object} API response envelope with products array.
   */
  static getPublicCatalog(filters = {}, sort = 'BEST_VALUE', limit = 20, offset = 0) {
    const sellerMap = this.getApprovedSellersMap_();
    const allProducts = SheetService.getAll(CONFIG.SHEETS.PRODUCTS);
    const customerLocality = filters.customer_locality || 'Garia Station';

    // Filter products: Must be APPROVED, active, and belong to an APPROVED seller
    let catalog = allProducts.filter(p => {
      if (p.approval_status !== CONFIG.APPROVAL_STATUS.APPROVED) return false;
      if (p.is_available === false) return false;
      const seller = sellerMap[p.seller_id];
      if (!seller) return false; // Seller not approved or inactive

      // Attribute filters
      if (filters.variety && String(p.variety).toLowerCase() !== String(filters.variety).toLowerCase()) return false;
      if (filters.brand && String(p.brand).toLowerCase() !== String(filters.brand).toLowerCase()) return false;
      if (filters.grain_type && String(p.grain_type).toUpperCase() !== String(filters.grain_type).toUpperCase()) return false;
      if (filters.pack_size && parseFloat(p.pack_size_kg) !== parseFloat(filters.pack_size)) return false;
      if (filters.max_price && parseFloat(p.price_inr) > parseFloat(filters.max_price)) return false;

      return true;
    });

    // Enrich products with seller bio, approximate distance, and delivery charges
    const enrichedList = catalog.map(p => {
      const seller = sellerMap[p.seller_id];
      const ricePrice = parseFloat(p.price_inr) || 0;
      const packWeight = parseFloat(p.pack_size_kg) || 25;
      const distKm = PricingService.calculateApproxDistance(seller.locality, customerLocality);
      const deliveryResult = PricingService.calculateDeliveryFee(distKm, packWeight);
      const deliveryFee = deliveryResult.totalDeliveryFee;
      const totalDelivered = PricingService.roundCurrency(ricePrice + deliveryFee);

      return {
        product_id: p.product_id,
        name_en: p.name_en,
        name_bn: p.name_bn || '',
        variety: p.variety,
        brand: p.brand,
        grain_type: p.grain_type,
        pack_size_kg: packWeight,
        pack_format: p.pack_format || CONFIG.PACK_FORMATS.SINGLE_BAG,
        price_inr: ricePrice,
        mrp_inr: parseFloat(p.mrp_inr) || ricePrice,
        stock_status: p.stock_status,
        description: p.description || '',
        origin: p.origin || 'Bengal Mills',
        is_featured: !!p.is_featured,
        // Seller details
        seller_id: seller.seller_id,
        seller_business_name: seller.business_name,
        seller_locality: seller.locality,
        seller_rating: parseFloat(seller.rating_avg) || 4.5,
        seller_review_count: parseInt(seller.review_count, 10) || 0,
        fssai_verified: !!seller.fssai_verified,
        // Delivered value calculations
        approx_distance_km: distKm,
        delivery_fee_inr: deliveryFee,
        total_delivered_price_inr: totalDelivered
      };
    });

    // Apply sorting logic
    enrichedList.sort((a, b) => {
      switch (sort) {
        case 'PRICE_ASC':
          return a.price_inr - b.price_inr;
        case 'NEAREST':
          return a.approx_distance_km - b.approx_distance_km;
        case 'RATING_DESC':
          return b.seller_rating - a.seller_rating;
        case 'BEST_VALUE':
        default:
          return a.total_delivered_price_inr - b.total_delivered_price_inr;
      }
    });

    // Paginate results
    const paginated = enrichedList.slice(offset, offset + limit);

    return {
      success: true,
      data: {
        total_count: enrichedList.length,
        returned_count: paginated.length,
        products: paginated
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Full details for a single product page, including gallery and live delivery preview.
   * @param {string} productId - Canonical Product ID.
   * @param {string} [customerLocality='Garia Station'] - Delivery locality for distance estimate.
   * @return {Object} API response envelope with full product DTO.
   */
  static getProductDetails(productId, customerLocality = 'Garia Station') {
    if (!productId) {
      return ErrorService.createClientError('Product ID is required.', ErrorService.CODES.INVALID_PARAMETERS);
    }

    const product = SheetService.findById(CONFIG.SHEETS.PRODUCTS, 'product_id', productId);
    if (!product || product.approval_status !== CONFIG.APPROVAL_STATUS.APPROVED) {
      return ErrorService.createClientError('Rice product not found or no longer active.', ErrorService.CODES.PRODUCT_NOT_FOUND);
    }

    const seller = SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', product.seller_id);
    if (!seller || seller.approval_status !== CONFIG.APPROVAL_STATUS.APPROVED) {
      return ErrorService.createClientError('The seller for this rice product is currently unavailable.', ErrorService.CODES.SELLER_NOT_FOUND);
    }

    // Retrieve product gallery images
    const images = SheetService.findByField(CONFIG.SHEETS.PRODUCT_IMAGES, 'product_id', productId);
    const imageUrls = images && images.length > 0
      ? images.sort((a, b) => (a.display_order || 0) - (b.display_order || 0)).map(img => img.image_url)
      : ['https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=600&q=80'];

    const distKm = PricingService.calculateApproxDistance(seller.locality, customerLocality);
    const weightKg = parseFloat(product.pack_size_kg) || 25;
    const deliveryResult = PricingService.calculateDeliveryFee(distKm, weightKg);
    const ricePrice = parseFloat(product.price_inr) || 0;
    const totalDelivered = PricingService.roundCurrency(ricePrice + deliveryResult.totalDeliveryFee);

    return {
      success: true,
      data: {
        product_id: product.product_id,
        name_en: product.name_en,
        name_bn: product.name_bn || '',
        variety: product.variety,
        brand: product.brand,
        grain_type: product.grain_type,
        pack_size_kg: weightKg,
        pack_format: product.pack_format || CONFIG.PACK_FORMATS.SINGLE_BAG,
        price_inr: ricePrice,
        mrp_inr: parseFloat(product.mrp_inr) || ricePrice,
        stock_status: product.stock_status,
        description: product.description || '',
        origin: product.origin || 'Bengal Mills',
        images: imageUrls,
        seller: {
          seller_id: seller.seller_id,
          business_name: seller.business_name,
          locality: seller.locality,
          address_line: seller.address_line,
          rating_avg: parseFloat(seller.rating_avg) || 4.5,
          review_count: parseInt(seller.review_count, 10) || 0,
          fssai_verified: !!seller.fssai_verified,
          fssai_number: seller.fssai_verified ? seller.fssai_number : ''
        },
        delivery_estimate: {
          customer_locality: customerLocality,
          approx_distance_km: distKm,
          delivery_fee_inr: deliveryResult.totalDeliveryFee,
          weight_surcharge_inr: deliveryResult.weightSurcharge,
          total_delivered_price_inr: totalDelivered
        }
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Multi-Seller Comparison Matrix.
   * Compares equivalent rice varieties across competing local sellers in Garia.
   * Automatically identifies and highlights the "BEST DELIVERED VALUE".
   * @param {string} variety - Target rice variety (e.g. 'Miniket').
   * @param {number} packSizeKg - Pack size (e.g. 25).
   * @param {string} [customerLocality='Garia Station'] - Delivery locality.
   * @return {Object} Comparison matrix response.
   */
  static getSellerComparison(variety, packSizeKg, customerLocality = 'Garia Station') {
    if (!variety || !packSizeKg) {
      return ErrorService.createClientError('Both rice variety and pack size are required for comparison.', ErrorService.CODES.INVALID_PARAMETERS);
    }

    const sellerMap = this.getApprovedSellersMap_();
    const allProducts = SheetService.getAll(CONFIG.SHEETS.PRODUCTS);
    const targetVariety = String(variety).trim().toLowerCase();
    const targetWeight = parseFloat(packSizeKg);

    // Filter equivalent products across approved sellers
    const equivalentProducts = allProducts.filter(p => {
      if (p.approval_status !== CONFIG.APPROVAL_STATUS.APPROVED) return false;
      if (p.is_available === false) return false;
      if (String(p.variety).trim().toLowerCase() !== targetVariety) return false;
      if (parseFloat(p.pack_size_kg) !== targetWeight) return false;
      return !!sellerMap[p.seller_id];
    });

    if (equivalentProducts.length === 0) {
      return {
        success: true,
        data: {
          variety: variety,
          pack_size_kg: targetWeight,
          customer_locality: customerLocality,
          comparisons: []
        },
        error: null,
        code: null,
        timestamp: new Date().toISOString()
      };
    }

    // Build side-by-side comparison array
    const comparisons = equivalentProducts.map(p => {
      const seller = sellerMap[p.seller_id];
      const ricePrice = parseFloat(p.price_inr) || 0;
      const distKm = PricingService.calculateApproxDistance(seller.locality, customerLocality);
      const deliveryResult = PricingService.calculateDeliveryFee(distKm, targetWeight);
      const deliveryFee = deliveryResult.totalDeliveryFee;
      const totalDelivered = PricingService.roundCurrency(ricePrice + deliveryFee);

      return {
        product_id: p.product_id,
        seller_id: seller.seller_id,
        seller_business_name: seller.business_name,
        seller_locality: seller.locality,
        seller_rating: parseFloat(seller.rating_avg) || 4.5,
        brand: p.brand,
        grain_type: p.grain_type,
        rice_price_inr: ricePrice,
        delivery_fee_inr: deliveryFee,
        total_delivered_inr: totalDelivered,
        approx_distance_km: distKm,
        is_best_value: false
      };
    });

    // Sort by Total Delivered Price ascending
    comparisons.sort((a, b) => a.total_delivered_inr - b.total_delivered_inr);

    // Tag the top option as "BEST_DELIVERED_VALUE"
    if (comparisons.length > 0) {
      comparisons[0].is_best_value = true;
    }

    return {
      success: true,
      data: {
        variety: variety,
        pack_size_kg: targetWeight,
        customer_locality: customerLocality,
        total_sellers_compared: comparisons.length,
        comparisons: comparisons
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Tokenized Bilingual Search (English & Bengali script).
   * @param {string} query - Keyword search term.
   * @param {string} [customerLocality='Garia Station'] - Delivery location.
   * @param {number|null} [packSize=null] - Optional pack size filter.
   * @return {Object} API response envelope with matching product list.
   */
  static searchProducts(query, customerLocality = 'Garia Station', packSize = null) {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return this.getPublicCatalog({ customer_locality: customerLocality, pack_size: packSize });
    }

    const tokens = this.expandSearchTokens(query);
    const sellerMap = this.getApprovedSellersMap_();
    const allProducts = SheetService.getAll(CONFIG.SHEETS.PRODUCTS);

    const matches = allProducts.filter(p => {
      if (p.approval_status !== CONFIG.APPROVAL_STATUS.APPROVED) return false;
      if (p.is_available === false) return false;
      if (!sellerMap[p.seller_id]) return false;
      if (packSize && parseFloat(p.pack_size_kg) !== parseFloat(packSize)) return false;

      const seller = sellerMap[p.seller_id];
      const searchCorpus = [
        p.name_en,
        p.name_bn,
        p.variety,
        p.brand,
        p.description,
        p.origin,
        seller.business_name,
        seller.locality
      ].join(' ').toLowerCase();

      // Matches if ANY search token exists in the product/seller text corpus
      return tokens.some(token => searchCorpus.includes(token));
    });

    // Enrich and rank matches by total delivered value
    const enriched = matches.map(p => {
      const seller = sellerMap[p.seller_id];
      const ricePrice = parseFloat(p.price_inr) || 0;
      const packWeight = parseFloat(p.pack_size_kg) || 25;
      const distKm = PricingService.calculateApproxDistance(seller.locality, customerLocality);
      const deliveryResult = PricingService.calculateDeliveryFee(distKm, packWeight);
      const deliveryFee = deliveryResult.totalDeliveryFee;

      return {
        product_id: p.product_id,
        name_en: p.name_en,
        name_bn: p.name_bn || '',
        variety: p.variety,
        brand: p.brand,
        grain_type: p.grain_type,
        pack_size_kg: packWeight,
        price_inr: ricePrice,
        seller_id: seller.seller_id,
        seller_business_name: seller.business_name,
        seller_locality: seller.locality,
        seller_rating: parseFloat(seller.rating_avg) || 4.5,
        approx_distance_km: distKm,
        delivery_fee_inr: deliveryFee,
        total_delivered_price_inr: PricingService.roundCurrency(ricePrice + deliveryFee)
      };
    });

    enriched.sort((a, b) => a.total_delivered_price_inr - b.total_delivered_price_inr);

    return {
      success: true,
      data: {
        query: query,
        match_count: enriched.length,
        products: enriched
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Merchant: Submits new rice product listing.
   * Product is placed in 'PENDING_REVIEW' until admin approval.
   * @param {Object} productData - Product fields.
   * @param {string} authToken - Merchant session token.
   * @return {Object} API response envelope with created product.
   */
  static submitProduct(productData, authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const sellerUser = auth.user;
    // Resolve seller_id from SELLERS table
    const sellers = SheetService.findByField(CONFIG.SHEETS.SELLERS, 'user_id', sellerUser.user_id);
    if (!sellers || sellers.length === 0) {
      return ErrorService.createClientError('No verified merchant profile linked to this user.', ErrorService.CODES.SELLER_NOT_FOUND);
    }
    const seller = sellers[0];

    const price = SecurityService.sanitizeNumber(productData.price_inr, 50, 100000, 0);
    const packSize = parseFloat(productData.pack_size_kg);

    if (price <= 0) {
      return ErrorService.createClientError('Price must be greater than ₹0.', ErrorService.CODES.VALIDATION_ERROR);
    }
    if (!CONFIG.PACK_SIZES.includes(packSize)) {
      return ErrorService.createClientError('Pack size must be one of: ' + CONFIG.PACK_SIZES.join(', ') + ' kg.', ErrorService.CODES.INVALID_PACK_SIZE);
    }

    const nowIso = new Date().toISOString();
    const newProduct = {
      product_id: SheetService.generateId('PRD'),
      seller_id: seller.seller_id,
      name_en: SecurityService.sanitizeText(productData.name_en, 150),
      name_bn: SecurityService.sanitizeText(productData.name_bn, 150),
      variety: SecurityService.sanitizeText(productData.variety, 80),
      brand: SecurityService.sanitizeText(productData.brand, 80) || 'Local Mill',
      grain_type: productData.grain_type || CONFIG.GRAIN_TYPES.PARBOILED,
      pack_size_kg: packSize,
      pack_format: productData.pack_format || CONFIG.PACK_FORMATS.SINGLE_BAG,
      price_inr: price,
      mrp_inr: SecurityService.sanitizeNumber(productData.mrp_inr, price, 150000, price),
      stock_status: productData.stock_status || CONFIG.STOCK_STATUS.IN_STOCK,
      is_available: true,
      approval_status: CONFIG.APPROVAL_STATUS.PENDING_REVIEW,
      description: SecurityService.sanitizeText(productData.description, 500),
      origin: SecurityService.sanitizeText(productData.origin, 100) || 'West Bengal',
      is_featured: false,
      created_at: nowIso,
      updated_at: nowIso
    };

    SheetService.insert(CONFIG.SHEETS.PRODUCTS, newProduct);

    return {
      success: true,
      data: {
        product: newProduct,
        message: 'Rice listing submitted successfully. Pending marketplace admin approval.'
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Merchant: Fast price adjustment and stock availability toggle.
   * Enforces IDOR checks and records price adjustments in AUDIT_LOG.
   * @param {string} productId - Product ID.
   * @param {number} [priceInr] - New price.
   * @param {string} [stockStatus] - New stock status.
   * @param {boolean} [isAvailable] - Fast toggle.
   * @param {string} authToken - Merchant session token.
   * @return {Object} API response envelope.
   */
  static updatePriceStock(productId, priceInr, stockStatus, isAvailable, authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.SELLER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const product = SheetService.findById(CONFIG.SHEETS.PRODUCTS, 'product_id', productId);
    if (!product) {
      return ErrorService.createClientError('Product not found.', ErrorService.CODES.PRODUCT_NOT_FOUND);
    }

    // Resolve merchant profile for IDOR ownership check
    const sellers = SheetService.findByField(CONFIG.SHEETS.SELLERS, 'user_id', auth.user.user_id);
    const sellerId = (sellers && sellers.length > 0) ? sellers[0].seller_id : null;

    if (!SecurityService.assertOwnership(product.seller_id, sellerId, auth.user.role)) {
      return ErrorService.createClientError('Unauthorized: You do not own this rice listing.', ErrorService.CODES.UNAUTHORIZED);
    }

    const updates = {};
    const oldPrice = parseFloat(product.price_inr);

    if (priceInr !== undefined && priceInr !== null) {
      const validPrice = SecurityService.sanitizeNumber(priceInr, 50, 100000, oldPrice);
      updates.price_inr = validPrice;
      if (validPrice !== oldPrice) {
        // Log price modification to Audit trail
        AuditService.logProductPriceChange(productId, product.seller_id, oldPrice, validPrice, 'Merchant dashboard update');
      }
    }

    if (stockStatus && Object.values(CONFIG.STOCK_STATUS).includes(stockStatus)) {
      updates.stock_status = stockStatus;
    }

    if (isAvailable !== undefined && isAvailable !== null) {
      updates.is_available = !!isAvailable;
    }

    updates.updated_at = new Date().toISOString();

    const updatedRecord = SheetService.updateById(CONFIG.SHEETS.PRODUCTS, 'product_id', productId, updates);

    return {
      success: true,
      data: {
        product: updatedRecord,
        message: 'Product inventory updated successfully.'
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Admin: Moderates product submission (APPROVED / REJECTED).
   * @param {string} productId - Target product ID.
   * @param {string} approvalStatus - APPROVED, REJECTED, SUSPENDED.
   * @param {string} [notes=''] - Admin feedback notes.
   * @param {string} adminAuthToken - Admin session token.
   * @return {Object} API response envelope.
   */
  static moderateProduct(productId, approvalStatus, notes = '', adminAuthToken) {
    const auth = SecurityService.authorizeRequest(adminAuthToken, [CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError('Admin authorization required.', ErrorService.CODES.UNAUTHORIZED);
    }

    const product = SheetService.findById(CONFIG.SHEETS.PRODUCTS, 'product_id', productId);
    if (!product) {
      return ErrorService.createClientError('Product not found.', ErrorService.CODES.PRODUCT_NOT_FOUND);
    }

    const oldStatus = product.approval_status;
    const updated = SheetService.updateById(CONFIG.SHEETS.PRODUCTS, 'product_id', productId, {
      approval_status: approvalStatus,
      updated_at: new Date().toISOString()
    });

    AuditService.logApprovalShift('PRODUCTS', productId, auth.user.user_id, oldStatus, approvalStatus, notes);

    return {
      success: true,
      data: {
        product: updated,
        message: 'Product approval status changed to ' + approvalStatus
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }
}
