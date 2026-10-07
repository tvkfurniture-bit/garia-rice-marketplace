/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - Code.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Master HTTP entrypoint and unified client RPC gateway.
 * Serves the responsive SPA web interface via doGet() and routes all client
 * operations via clientApiCall() through google.script.run.
 */

/**
 * Handles all incoming HTTP GET requests.
 * Evaluates route parameters and serves the mobile-first HTML client.
 * @param {Object} e - Event object containing URL query parameters.
 * @return {HtmlOutput} Configured mobile-ready HTML document.
 */
function doGet(e) {
  try {
    const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'home';
    const params = (e && e.parameter) ? e.parameter : {};

    // Delegate HTML template assembly to Router
    let htmlOutput;
    if (typeof Router !== 'undefined' && typeof Router.renderView === 'function') {
      htmlOutput = Router.renderView(page, params);
    } else {
      // Fallback before Router.gs is initialized
      htmlOutput = HtmlService.createHtmlOutput(
        '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<title>' + CONFIG.APP.NAME + '</title></head><body>' +
        '<h2>' + CONFIG.APP.NAME + '</h2>' +
        '<p>' + CONFIG.APP.TAGLINE + '</p>' +
        '<p>Initializing marketplace services... Please deploy Router.gs.</p>' +
        '</body></html>'
      );
    }

    return htmlOutput
      .setTitle(CONFIG.APP.NAME + ' — ' + CONFIG.APP.TAGLINE)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=5.0')
      .addMetaTag('description', 'Compare rice prices, pack sizes (2kg to 50kg), and delivery fees from verified local sellers in Garia, Kolkata.')
      .addMetaTag('theme-color', '#1b4332')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  } catch (err) {
    Logger.log('[Code.doGet] Fatal error rendering view: ' + err.toString());
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:24px;text-align:center;">' +
      '<h2>' + CONFIG.APP.NAME + '</h2>' +
      '<p>We are experiencing a temporary operational issue. Please refresh or contact support at ' +
      CONFIG.APP.SUPPORT_EMAIL + '</p>' +
      '</div>'
    ).setTitle(CONFIG.APP.NAME);
  }
}

/**
 * Handles incoming HTTP POST requests (e.g., external webhooks, payments, or headless APIs).
 * @param {Object} e - Event object containing post data.
 * @return {TextOutput} Standardized JSON response.
 */
function doPost(e) {
  const response = {
    success: false,
    data: null,
    error: 'Invalid Request',
    code: 'INVALID_POST_REQUEST',
    timestamp: new Date().toISOString()
  };

  try {
    if (!e || !e.postData || !e.postData.contents) {
      response.error = 'No post body provided';
      response.code = 'EMPTY_BODY';
      return ContentService.createTextOutput(JSON.stringify(response))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      response.error = 'Malformed JSON payload';
      response.code = 'JSON_PARSE_ERROR';
      return ContentService.createTextOutput(JSON.stringify(response))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const action = payload.action;
    const data = payload.data || {};
    const authToken = payload.authToken || null;

    // Route through the unified API dispatcher
    const result = clientApiCall(action, data, authToken);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('[Code.doPost] Unhandled error: ' + err.toString());
    response.error = 'Internal server processing error';
    response.code = 'SERVER_ERROR';
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Master client RPC gateway invoked by frontend via google.script.run.
 * Dispatches requests to domain services with unified error protection.
 * @param {string} action - Registered API action identifier.
 * @param {Object} payload - Input payload for the action.
 * @param {string} [authToken] - Optional session token for authenticated operations.
 * @return {Object} Standardized response envelope { success, data, error, code, timestamp }.
 */
function clientApiCall(action, payload, authToken) {
  const envelope = {
    success: false,
    data: null,
    error: null,
    code: null,
    timestamp: new Date().toISOString()
  };

  try {
    if (!action || typeof action !== 'string') {
      envelope.error = 'Action must be a valid non-empty string.';
      envelope.code = 'INVALID_ACTION';
      return envelope;
    }

    payload = payload || {};

    // Core System & Bootstrap Actions
    switch (action) {
      case 'getInitialAppContext':
        envelope.data = getInitialAppContext();
        envelope.success = true;
        return envelope;

      case 'pingHealth':
        envelope.data = pingHealth();
        envelope.success = true;
        return envelope;

      // ----------------------------------------------------------------------
      // DOMAIN SERVICE DISPATCHERS
      // Delegated to respective services once implemented in Phases 2 & 3.
      // Graceful fallback returns 'SERVICE_NOT_YET_READY' if not yet loaded.
      // ----------------------------------------------------------------------

      // Product & Catalog Discovery
      case 'getPublicCatalog':
      case 'getProductDetails':
      case 'getSellerComparison':
      case 'searchProducts':
        if (typeof ProductService !== 'undefined' && typeof ProductService.dispatch === 'function') {
          return ProductService.dispatch(action, payload, authToken);
        }
        break;

      // Pricing & Delivery Calculations
      case 'calculateDeliveryEstimate':
      case 'getPricingBreakdown':
        if (typeof PricingService !== 'undefined' && typeof PricingService.dispatch === 'function') {
          return PricingService.dispatch(action, payload, authToken);
        }
        break;

      // Order Management & State Machine
      case 'createOrder':
      case 'getOrderDetails':
      case 'updateOrderStatus':
      case 'getCustomerOrders':
        if (typeof OrderService !== 'undefined' && typeof OrderService.dispatch === 'function') {
          return OrderService.dispatch(action, payload, authToken);
        }
        break;

      // Seller Operations
      case 'submitSellerApplication':
      case 'getSellerDashboard':
      case 'updateProductAvailability':
      case 'updateProductPrice':
        if (typeof SellerService !== 'undefined' && typeof SellerService.dispatch === 'function') {
          return SellerService.dispatch(action, payload, authToken);
        }
        break;

      // Delivery Partner Operations
      case 'submitRiderApplication':
      case 'getRiderJobs':
      case 'claimDeliveryJob':
      case 'updateDeliveryStatus':
        if (typeof DeliveryService !== 'undefined' && typeof DeliveryService.dispatch === 'function') {
          return DeliveryService.dispatch(action, payload, authToken);
        }
        break;

      // Reviews & Social Sharing
      case 'submitOrderReview':
      case 'getApprovedReviews':
        if (typeof ReviewService !== 'undefined' && typeof ReviewService.dispatch === 'function') {
          return ReviewService.dispatch(action, payload, authToken);
        }
        break;

      // User Authentication & Profile
      case 'authenticateUser':
      case 'verifySession':
      case 'updateCustomerProfile':
        if (typeof AuthService !== 'undefined' && typeof AuthService.dispatch === 'function') {
          return AuthService.dispatch(action, payload, authToken);
        }
        break;

      default:
        envelope.error = 'Unrecognized action: ' + action;
        envelope.code = 'UNKNOWN_ACTION';
        return envelope;
    }

    // If reached here, service was recognized in switch but service class is not yet loaded
    envelope.error = 'Service handler for [' + action + '] is currently initializing.';
    envelope.code = 'SERVICE_NOT_YET_READY';
    return envelope;

  } catch (err) {
    Logger.log('[Code.clientApiCall] Unhandled error during action [' + action + ']: ' + err.toString());
    envelope.error = 'An unexpected server error occurred while processing your request.';
    envelope.code = 'UNHANDLED_EXCEPTION';
    return envelope;
  }
}

/**
 * Returns public bootstrap configuration required by client browser to render
 * hero search, zone dropdowns, pack sizes, and branding without hardcoding.
 * Sensitive admin keys and spreadsheet IDs are strictly excluded.
 * @return {Object} Public application context.
 */
function getInitialAppContext() {
  return {
    appName: CONFIG.APP.NAME,
    tagline: CONFIG.APP.TAGLINE,
    currencySymbol: CONFIG.APP.CURRENCY_SYMBOL,
    currencyCode: CONFIG.APP.CURRENCY,
    serviceZones: CONFIG.SERVICE_ZONES,
    packSizes: CONFIG.PACK_SIZES,
    grainTypes: CONFIG.GRAIN_TYPES,
    supportEmail: CONFIG.APP.SUPPORT_EMAIL,
    supportPhone: CONFIG.APP.SUPPORT_PHONE,
    minOrderValue: CONFIG.DEFAULTS.MINIMUM_ORDER_VALUE_INR,
    baseDeliveryFee: CONFIG.DEFAULTS.BASE_DELIVERY_FEE_INR,
    baseDeliveryRadius: CONFIG.DEFAULTS.BASE_DELIVERY_RADIUS_KM
  };
}

/**
 * Diagnostic ping function to verify backend responsiveness, execution time,
 * and database configuration status.
 * @return {Object} System health status report.
 */
function pingHealth() {
  const startTime = new Date().getTime();
  const spreadsheetId = AppConfig.getSpreadsheetId();
  let dbConnected = false;

  if (spreadsheetId) {
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      if (ss) {
        dbConnected = true;
      }
    } catch (e) {
      Logger.log('[Code.pingHealth] DB Connection probe failed: ' + e.message);
    }
  }

  return {
    status: 'ONLINE',
    version: CONFIG.APP.VERSION,
    timezone: CONFIG.APP.TIMEZONE,
    timestamp: new Date().toISOString(),
    spreadsheetConfigured: !!spreadsheetId,
    databaseReachable: dbConnected,
    latencyMs: new Date().getTime() - startTime
  };
}
