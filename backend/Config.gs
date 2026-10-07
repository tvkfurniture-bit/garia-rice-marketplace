/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - Config.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Central configuration registry and immutable runtime constants.
 * All sheet names, order states, roles, delivery defaults, and business rules
 * are governed here. No magic strings or hardcoded values elsewhere in codebase.
 */

// Deep freeze helper to guarantee immutability in V8 runtime
function deepFreezeConfig_(obj) {
  Object.keys(obj).forEach(function(prop) {
    if (typeof obj[prop] === 'object' && obj[prop] !== null && !Object.isFrozen(obj[prop])) {
      deepFreezeConfig_(obj[prop]);
    }
  });
  return Object.freeze(obj);
}

const CONFIG = deepFreezeConfig_({
  APP: {
    NAME: 'Garia Rice Marketplace™',
    SHORT_NAME: 'Garia Rice',
    TAGLINE: 'Compare. Choose. Delivered.',
    VERSION: '1.0.0',
    TIMEZONE: 'Asia/Kolkata',
    LOCALE: 'en-IN',
    CURRENCY: 'INR',
    CURRENCY_SYMBOL: '₹',
    SUPPORT_EMAIL: 'support@gariarice.in',
    SUPPORT_PHONE: '+91 98300 00000',
    MAX_EXECUTION_MS: 300000 // 5 minutes safety ceiling (Apps Script hard limit is 6 min)
  },

  // All 22 Database Tables matching Phase 0 Schema
  SHEETS: {
    CONFIG: 'CONFIG',
    USERS: 'USERS',
    CUSTOMERS: 'CUSTOMERS',
    SELLERS: 'SELLERS',
    SELLER_DOCUMENTS: 'SELLER_DOCUMENTS',
    PRODUCTS: 'PRODUCTS',
    PRODUCT_IMAGES: 'PRODUCT_IMAGES',
    CATEGORIES: 'CATEGORIES',
    ORDERS: 'ORDERS',
    ORDER_ITEMS: 'ORDER_ITEMS',
    ORDER_STATUS_LOG: 'ORDER_STATUS_LOG',
    DELIVERY_PARTNERS: 'DELIVERY_PARTNERS',
    DELIVERY_ASSIGNMENTS: 'DELIVERY_ASSIGNMENTS',
    REVIEWS: 'REVIEWS',
    NOTIFICATIONS: 'NOTIFICATIONS',
    NOTIFICATION_LOG: 'NOTIFICATION_LOG',
    PAYMENTS: 'PAYMENTS',
    SERVICE_ZONES: 'SERVICE_ZONES',
    DELIVERY_PRICING: 'DELIVERY_PRICING',
    ADMIN_USERS: 'ADMIN_USERS',
    AUDIT_LOG: 'AUDIT_LOG',
    FACEBOOK_DRAFTS: 'FACEBOOK_DRAFTS'
  },

  // Finite State Machine (Strictly validated across lifecycle)
  ORDER_STATUS: {
    PLACED: 'PLACED',
    SELLER_NOTIFIED: 'SELLER_NOTIFIED',
    SELLER_CONFIRMED: 'SELLER_CONFIRMED',
    PACKING: 'PACKING',
    READY_FOR_PICKUP: 'READY_FOR_PICKUP',
    RIDER_ASSIGNED: 'RIDER_ASSIGNED',
    RIDER_ACCEPTED: 'RIDER_ACCEPTED',
    PICKED_UP: 'PICKED_UP',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
    CUSTOMER_CONFIRMED: 'CUSTOMER_CONFIRMED',
    REVIEW_REQUESTED: 'REVIEW_REQUESTED',
    COMPLETED: 'COMPLETED',
    // Exception States
    SELLER_REJECTED: 'SELLER_REJECTED',
    CANCELLED_BY_CUSTOMER: 'CANCELLED_BY_CUSTOMER',
    CANCELLED_BY_SELLER: 'CANCELLED_BY_SELLER',
    DELIVERY_FAILED: 'DELIVERY_FAILED',
    PAYMENT_FAILED: 'PAYMENT_FAILED'
  },

  ROLES: {
    GUEST: 'GUEST',
    CUSTOMER: 'CUSTOMER',
    SELLER: 'SELLER',
    RIDER: 'RIDER',
    ADMIN: 'ADMIN',
    SYSTEM: 'SYSTEM'
  },

  APPROVAL_STATUS: {
    DRAFT: 'DRAFT',
    PENDING_REVIEW: 'PENDING_REVIEW',
    UNDER_REVIEW: 'UNDER_REVIEW',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    SUSPENDED: 'SUSPENDED'
  },

  STOCK_STATUS: {
    IN_STOCK: 'IN_STOCK',
    LOW_STOCK: 'LOW_STOCK',
    OUT_OF_STOCK: 'OUT_OF_STOCK'
  },

  GRAIN_TYPES: {
    PARBOILED: 'PARBOILED', // সিদ্ধ (Sidhdho)
    RAW: 'RAW',             // আতপ (Atap)
    AROMATIC: 'AROMATIC',   // গোবিন্দভোগ / বাসমতী
    SPECIALTY: 'SPECIALTY'  // ব্রাউন / সুগার-ফ্রি
  },

  PACK_SIZES: [2, 5, 10, 25, 26, 50],

  PACK_FORMATS: {
    SINGLE_BAG: 'SINGLE_BAG',
    DUAL_25KG_BAGS: 'DUAL_25KG_BAGS' // Specifically for 50kg representation
  },

  PAYMENT_METHODS: {
    COD: 'COD',
    UPI_ON_DELIVERY: 'UPI_ON_DELIVERY'
  },

  PAYMENT_STATUS: {
    PENDING: 'PENDING',
    COLLECTED: 'COLLECTED',
    FAILED: 'FAILED',
    REFUNDED: 'REFUNDED'
  },

  VEHICLE_TYPES: {
    CYCLE: {
      KEY: 'CYCLE',
      LABEL: 'Bicycle / Walker',
      MAX_LOAD_KG: 25.0,
      MAX_RADIUS_KM: 1.5
    },
    MOTORCYCLE: {
      KEY: 'MOTORCYCLE',
      LABEL: 'Motorcycle / Scooter',
      MAX_LOAD_KG: 60.0,
      MAX_RADIUS_KM: 6.0
    },
    TOTO_CARGO: {
      KEY: 'TOTO_CARGO',
      LABEL: 'E-Rickshaw / Toto Cargo',
      MAX_LOAD_KG: 250.0,
      MAX_RADIUS_KM: 10.0
    }
  },

  // Service Geography: Garia & Contiguous Hyperlocal Localities
  SERVICE_ZONES: [
    {
      id: 'ZONE-GARIA-01',
      name: 'Garia Station & Kanungo Park',
      pincodes: ['700084'],
      landmarks: ['Garia Station', 'Kanungo Park', 'Kavi Nazrul Metro', 'Baroda Avenue']
    },
    {
      id: 'ZONE-GARIA-02',
      name: 'Baishnabghata & Patuli',
      pincodes: ['700084', '700094'],
      landmarks: ['Patuli Floating Market', 'Baishnabghata', 'Satyajit Ray Park', 'Ghoshpara']
    },
    {
      id: 'ZONE-GARIA-03',
      name: 'Mahamayatala & Garia Main Road',
      pincodes: ['700084', '700050'],
      landmarks: ['Mahamayatala', 'Hindustan More', 'Garia Bazar', 'Sheetala Mandir']
    },
    {
      id: 'ZONE-GARIA-04',
      name: 'Naktala & Bansdroni Border',
      pincodes: ['700047'],
      landmarks: ['Naktala', 'Geetanjali Metro', 'Ranikuthi More']
    },
    {
      id: 'ZONE-GARIA-05',
      name: 'Kamalgazi & Narendrapur Border',
      pincodes: ['700103'],
      landmarks: ['Kamalgazi Bypass', 'Ramakrishna Mission', 'Sonarpur Road Crossing']
    },
    {
      id: 'ZONE-GARIA-06',
      name: 'Boral & Rajpur Border',
      pincodes: ['700154', '700149'],
      landmarks: ['Boral High School', 'Tripura Sundari Temple', 'Rajpur Bazar']
    }
  ],

  // Default Business Formulas (Configurable via Script Properties / CONFIG Sheet)
  DEFAULTS: {
    COMMISSION_PERCENT: 7.0,             // Minimum 6-8% business target
    BASE_DELIVERY_FEE_INR: 25.0,         // Flat fee for initial slab
    BASE_DELIVERY_RADIUS_KM: 2.0,        // Initial slab distance
    EXCESS_DISTANCE_PER_KM_INR: 10.0,    // Distance beyond base slab
    WEIGHT_THRESHOLD_KG: 25.0,           // Included weight before surcharge
    EXCESS_WEIGHT_PER_KG_INR: 1.5,       // ₹1.50 per kg above 25kg
    RIDER_PAYOUT_SHARE_PCT: 80.0,        // 80% of delivery fee passed to rider
    MAX_DELIVERY_RADIUS_KM: 8.0,         // Maximum service reach from Garia core
    SELLER_TIMEOUT_MINUTES: 20,          // Time allowed for seller to confirm order
    RIDER_ACCEPT_TIMEOUT_SECONDS: 300,   // 5 minutes for rider to accept job
    MINIMUM_ORDER_VALUE_INR: 100.0,
    SESSION_TOKEN_EXPIRY_HOURS: 720      // 30 days session persistence
  },

  // Security & Lock Timeouts
  SECURITY: {
    LOCK_TIMEOUT_MS: 15000,              // 15 seconds ScriptLock for order transitions
    BCRYPT_WORK_FACTOR: 10,
    TOKEN_BYTE_LENGTH: 32,
    MAX_FAILED_LOGINS: 5,
    LOCKOUT_MINUTES: 30
  }
});

/**
 * Accessor class for dynamic runtime properties stored in Script Properties.
 * Enables live modification of business variables without touching codebase.
 */
class AppConfig {
  /**
   * Retrieves dynamic property with fallback to immutable defaults
   * @param {string} key - Property key name
   * @param {*} fallbackValue - Fallback value if property is unset
   * @return {*} Resolved property value
   */
  static get(key, fallbackValue = null) {
    try {
      const props = PropertiesService.getScriptProperties();
      const val = props.getProperty(key);
      if (val !== null && val !== undefined) {
        // Attempt JSON parse for objects/booleans/numbers
        try {
          return JSON.parse(val);
        } catch (e) {
          return val;
        }
      }
    } catch (err) {
      Logger.log('[Config.get] Error accessing PropertiesService: ' + err.message);
    }
    return fallbackValue;
  }

  /**
   * Sets dynamic property in Script Properties
   * @param {string} key - Property key name
   * @param {*} value - Value to store (objects are stringified)
   */
  static set(key, value) {
    const props = PropertiesService.getScriptProperties();
    const storeVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
    props.setProperty(key, storeVal);
  }

  /**
   * Retrieves active Google Spreadsheet ID
   * @return {string} Spreadsheet ID from Script Properties
   */
  static getSpreadsheetId() {
    const id = this.get('SPREADSHEET_ID', '');
    if (!id) {
      Logger.log('[Config.getSpreadsheetId] WARNING: SPREADSHEET_ID is not configured in Script Properties.');
    }
    return id;
  }

  /**
   * Returns active platform commission percentage
   * @return {number} Commission percentage (e.g., 7.0)
   */
  static getCommissionPercent() {
    const comm = this.get('COMMISSION_PERCENT', CONFIG.DEFAULTS.COMMISSION_PERCENT);
    return typeof comm === 'number' ? comm : parseFloat(comm) || CONFIG.DEFAULTS.COMMISSION_PERCENT;
  }

  /**
   * Checks if marketplace is operating in live production mode
   * @return {boolean} True if production, false if test/demo
   */
  static isProduction() {
    return this.get('ENVIRONMENT', 'DEVELOPMENT') === 'PRODUCTION';
  }
}
