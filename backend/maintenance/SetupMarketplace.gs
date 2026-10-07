/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - SetupMarketplace.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Master Database Initializer and Schema Provisioner.
 * Provisions all 22 database tables, creates styled frozen headers, seeds
 * default business config, service zones, delivery pricing slabs, and categories.
 * 100% IDEMPOTENT: Safe to run repeatedly without overwriting existing data.
 */

/**
 * Top-level runner function selectable from Apps Script editor toolbar dropdown.
 * Select 'setupMarketplace' and click 'Run'.
 */
function setupMarketplace() {
  return SetupMarketplace.initialize();
}

class SetupMarketplace {
  /**
   * Complete schema definitions for all 22 database tables matching Phase 0.
   * Defines exact column headers in canonical relational order.
   */
  static get TABLE_SCHEMAS() {
    return {
      [CONFIG.SHEETS.CONFIG]: [
        'config_id', 'config_key', 'config_value', 'description', 'updated_at', 'updated_by'
      ],
      [CONFIG.SHEETS.USERS]: [
        'user_id', 'role', 'phone', 'email', 'auth_token_hash', 'token_expiry', 'status', 'created_at', 'updated_at'
      ],
      [CONFIG.SHEETS.CUSTOMERS]: [
        'customer_id', 'user_id', 'full_name', 'primary_phone', 'whatsapp_phone', 'saved_addresses', 'default_zone_id', 'total_orders', 'created_at', 'updated_at'
      ],
      [CONFIG.SHEETS.SELLERS]: [
        'seller_id', 'user_id', 'business_name', 'owner_name', 'contact_phone', 'whatsapp_phone', 'email', 'address_line', 'locality', 'pincode', 'latitude', 'longitude', 'service_radius_km', 'fssai_number', 'fssai_verified', 'operating_hours', 'is_open', 'rating_avg', 'review_count', 'approval_status', 'commission_override_pct', 'created_at', 'updated_at'
      ],
      [CONFIG.SHEETS.SELLER_DOCUMENTS]: [
        'doc_id', 'seller_id', 'doc_type', 'file_url', 'verification_status', 'notes', 'created_at'
      ],
      [CONFIG.SHEETS.PRODUCTS]: [
        'product_id', 'seller_id', 'name_en', 'name_bn', 'variety', 'brand', 'grain_type', 'pack_size_kg', 'pack_format', 'price_inr', 'mrp_inr', 'stock_status', 'is_available', 'approval_status', 'description', 'origin', 'is_featured', 'created_at', 'updated_at'
      ],
      [CONFIG.SHEETS.PRODUCT_IMAGES]: [
        'image_id', 'product_id', 'image_url', 'is_primary', 'display_order', 'created_at'
      ],
      [CONFIG.SHEETS.CATEGORIES]: [
        'category_id', 'category_name', 'slug', 'is_active', 'display_order'
      ],
      [CONFIG.SHEETS.ORDERS]: [
        'order_id', 'customer_id', 'seller_id', 'current_status', 'subtotal_inr', 'delivery_fee_inr', 'platform_fee_inr', 'total_amount_inr', 'commission_inr', 'seller_payout_inr', 'rider_payout_inr', 'total_weight_kg', 'delivery_address', 'delivery_locality', 'approx_distance_km', 'payment_method', 'payment_status', 'created_at', 'updated_at'
      ],
      [CONFIG.SHEETS.ORDER_ITEMS]: [
        'item_id', 'order_id', 'product_id', 'product_name', 'variety', 'pack_size_kg', 'unit_price_inr', 'quantity', 'line_total_inr'
      ],
      [CONFIG.SHEETS.ORDER_STATUS_LOG]: [
        'log_id', 'order_id', 'from_status', 'to_status', 'actor_id', 'actor_role', 'remarks', 'timestamp'
      ],
      [CONFIG.SHEETS.DELIVERY_PARTNERS]: [
        'rider_id', 'user_id', 'full_name', 'phone', 'vehicle_type', 'max_payload_kg', 'service_zones', 'current_status', 'verification_status', 'rating_avg', 'total_deliveries', 'created_at', 'updated_at'
      ],
      [CONFIG.SHEETS.DELIVERY_ASSIGNMENTS]: [
        'assignment_id', 'order_id', 'rider_id', 'assignment_status', 'dispatched_at', 'accepted_at', 'picked_up_at', 'delivered_at', 'payout_inr'
      ],
      [CONFIG.SHEETS.REVIEWS]: [
        'review_id', 'order_id', 'customer_id', 'seller_id', 'product_id', 'overall_rating', 'rice_quality_rating', 'delivery_rating', 'review_text', 'moderation_status', 'fb_draft_created', 'created_at', 'moderated_at'
      ],
      [CONFIG.SHEETS.NOTIFICATIONS]: [
        'template_id', 'event_name', 'channel', 'subject_template', 'body_template', 'is_active'
      ],
      [CONFIG.SHEETS.NOTIFICATION_LOG]: [
        'notification_id', 'event_name', 'recipient_role', 'recipient_contact', 'channel', 'delivery_status', 'payload_snippet', 'error_details', 'timestamp'
      ],
      [CONFIG.SHEETS.PAYMENTS]: [
        'payment_id', 'order_id', 'payment_type', 'amount_inr', 'collected_by_id', 'reconciliation_status', 'settlement_notes', 'timestamp'
      ],
      [CONFIG.SHEETS.SERVICE_ZONES]: [
        'zone_id', 'zone_name', 'pincodes', 'covered_landmarks', 'is_active'
      ],
      [CONFIG.SHEETS.DELIVERY_PRICING]: [
        'rule_id', 'min_distance_km', 'max_distance_km', 'base_price_inr', 'weight_threshold_kg', 'excess_weight_per_kg_inr', 'rider_cut_percentage'
      ],
      [CONFIG.SHEETS.ADMIN_USERS]: [
        'admin_id', 'user_id', 'full_name', 'access_level', 'created_at'
      ],
      [CONFIG.SHEETS.AUDIT_LOG]: [
        'audit_id', 'actor_id', 'actor_role', 'action_verb', 'entity_name', 'entity_id', 'old_state_json', 'new_state_json', 'ip_or_useragent', 'timestamp'
      ],
      [CONFIG.SHEETS.FACEBOOK_DRAFTS]: [
        'draft_id', 'review_id', 'post_headline', 'post_body', 'hashtags', 'status', 'created_at'
      ]
    };
  }

  /**
   * Master initialization runner.
   * Resolves target spreadsheet, creates missing sheets, writes styled headers,
   * seeds baseline configuration, and purges memory cache.
   */
  static initialize() {
    Logger.log('================================================================');
    Logger.log('🌾 GARIA RICE MARKETPLACE™ - DATABASE INITIALIZATION STARTING');
    Logger.log('================================================================');

    let ss;
    // 1. Resolve spreadsheet: container-bound or via Script Properties
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    } catch (e) {
      ss = null;
    }

    if (!ss) {
      const configuredId = AppConfig.getSpreadsheetId();
      if (configuredId) {
        ss = SpreadsheetApp.openById(configuredId);
      }
    }

    if (!ss) {
      // If still not resolved, create a brand new Google Spreadsheet automatically
      Logger.log('[SetupMarketplace] Creating new production Google Spreadsheet...');
      ss = SpreadsheetApp.create('Garia Rice Marketplace™ Database (Production)');
      const newId = ss.getId();
      AppConfig.set('SPREADSHEET_ID', newId);
      Logger.log('[SetupMarketplace] SUCCESS: Created spreadsheet with ID: ' + newId);
      Logger.log('[SetupMarketplace] Automatically saved SPREADSHEET_ID into Script Properties.');
    } else {
      // Bind resolved ID into Script Properties
      AppConfig.set('SPREADSHEET_ID', ss.getId());
      Logger.log('[SetupMarketplace] Operating on Spreadsheet: ' + ss.getName() + ' (' + ss.getId() + ')');
    }

    // 2. Iterate through all 22 schemas and provision sheets idempotently
    const schemas = this.TABLE_SCHEMAS;
    let createdCount = 0;
    let existingCount = 0;

    for (const [sheetName, headers] of Object.entries(schemas)) {
      let sheet = ss.getSheetByName(sheetName);

      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        createdCount++;
        Logger.log(' -> Created table: [' + sheetName + ']');
      } else {
        existingCount++;
      }

      // Check if header row exists
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();

      if (lastRow === 0 || lastCol === 0) {
        // Write headers and apply styling
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        this.styleHeaderRow_(sheet, headers.length);
      }
    }

    // Remove default "Sheet1" if all tables exist and Sheet1 is empty
    const defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
      try {
        ss.deleteSheet(defaultSheet);
      } catch (e) {
        // Ignore if cannot delete
      }
    }

    // 3. Seed baseline reference data idempotently
    this.seedDefaultConfig_(ss);
    this.seedServiceZones_(ss);
    this.seedDeliveryPricing_(ss);
    this.seedCategories_(ss);

    // 4. Purge ORM header cache
    if (typeof SheetService !== 'undefined' && typeof SheetService.clearCache === 'function') {
      SheetService.clearCache();
    }

    Logger.log('================================================================');
    Logger.log('🌾 SETUP COMPLETE: 22 Tables Active | Created: ' + createdCount + ' | Verified: ' + existingCount);
    Logger.log('Spreadsheet URL: ' + ss.getUrl());
    Logger.log('================================================================');

    return {
      success: true,
      spreadsheet_id: ss.getId(),
      spreadsheet_url: ss.getUrl(),
      total_tables: Object.keys(schemas).length,
      created_tables: createdCount,
      existing_tables: existingCount
    };
  }

  /**
   * Applies green branding style to table header row (Row 1).
   * @private
   */
  static styleHeaderRow_(sheet, columnCount) {
    const headerRange = sheet.getRange(1, 1, 1, columnCount);
    headerRange
      .setBackground('#1b4332')       // Brand Deep Forest Green
      .setFontColor('#ffffff')       // Pure White text
      .setFontWeight('bold')
      .setFontFamily('Arial')
      .setFontSize(10)
      .setHorizontalAlignment('left');

    sheet.setFrozenRows(1);          // Freeze Row 1
  }

  /**
   * Seeds default business configuration into CONFIG table if empty.
   * @private
   */
  static seedDefaultConfig_(ss) {
    const sheet = ss.getSheetByName(CONFIG.SHEETS.CONFIG);
    if (!sheet || sheet.getLastRow() > 1) return; // Already seeded

    const nowIso = new Date().toISOString();
    const defaults = [
      ['CFG-001', 'MARKETPLACE_NAME', CONFIG.APP.NAME, 'Public brand name', nowIso, 'SYSTEM'],
      ['CFG-002', 'COMMISSION_PERCENT', String(CONFIG.DEFAULTS.COMMISSION_PERCENT), 'Platform take rate percentage', nowIso, 'SYSTEM'],
      ['CFG-003', 'BASE_DELIVERY_FEE_INR', String(CONFIG.DEFAULTS.BASE_DELIVERY_FEE_INR), 'Base delivery charge for initial slab', nowIso, 'SYSTEM'],
      ['CFG-004', 'BASE_DELIVERY_RADIUS_KM', String(CONFIG.DEFAULTS.BASE_DELIVERY_RADIUS_KM), 'Distance included in base fee', nowIso, 'SYSTEM'],
      ['CFG-005', 'EXCESS_DISTANCE_PER_KM_INR', String(CONFIG.DEFAULTS.EXCESS_DISTANCE_PER_KM_INR), 'Fee per km beyond base slab', nowIso, 'SYSTEM'],
      ['CFG-006', 'WEIGHT_THRESHOLD_KG', String(CONFIG.DEFAULTS.WEIGHT_THRESHOLD_KG), 'Included weight before surcharge', nowIso, 'SYSTEM'],
      ['CFG-007', 'EXCESS_WEIGHT_PER_KG_INR', String(CONFIG.DEFAULTS.EXCESS_WEIGHT_PER_KG_INR), 'Surcharge per kg over threshold', nowIso, 'SYSTEM'],
      ['CFG-008', 'RIDER_PAYOUT_SHARE_PCT', String(CONFIG.DEFAULTS.RIDER_PAYOUT_SHARE_PCT), 'Rider delivery fee compensation share', nowIso, 'SYSTEM'],
      ['CFG-009', 'WHATSAPP_PROVIDER', 'CLICK_TO_CHAT', 'Messaging mode: CLICK_TO_CHAT or META_CLOUD_API', nowIso, 'SYSTEM'],
      ['CFG-010', 'ENVIRONMENT', 'PRODUCTION', 'Active operational mode', nowIso, 'SYSTEM']
    ];

    sheet.getRange(2, 1, defaults.length, defaults[0].length).setValues(defaults);
    Logger.log(' -> Seeded CONFIG table with 10 default parameters.');
  }

  /**
   * Seeds Garia hyperlocal service zones into SERVICE_ZONES table.
   * @private
   */
  static seedServiceZones_(ss) {
    const sheet = ss.getSheetByName(CONFIG.SHEETS.SERVICE_ZONES);
    if (!sheet || sheet.getLastRow() > 1) return;

    const zones = CONFIG.SERVICE_ZONES.map(z => [
      z.id,
      z.name,
      JSON.stringify(z.pincodes),
      JSON.stringify(z.landmarks),
      true
    ]);

    sheet.getRange(2, 1, zones.length, zones[0].length).setValues(zones);
    Logger.log(' -> Seeded SERVICE_ZONES table with ' + zones.length + ' Garia zones.');
  }

  /**
   * Seeds standard delivery pricing slabs into DELIVERY_PRICING table.
   * @private
   */
  static seedDeliveryPricing_(ss) {
    const sheet = ss.getSheetByName(CONFIG.SHEETS.DELIVERY_PRICING);
    if (!sheet || sheet.getLastRow() > 1) return;

    const slabs = [
      ['RULE-01', 0.0, 2.0, 25.0, 25.0, 1.5, 80.0],
      ['RULE-02', 2.0, 4.0, 35.0, 25.0, 1.5, 80.0],
      ['RULE-03', 4.0, 8.0, 50.0, 25.0, 1.5, 80.0]
    ];

    sheet.getRange(2, 1, slabs.length, slabs[0].length).setValues(slabs);
    Logger.log(' -> Seeded DELIVERY_PRICING table with 3 distance slabs.');
  }

  /**
   * Seeds core rice categories into CATEGORIES table.
   * @private
   */
  static seedCategories_(ss) {
    const sheet = ss.getSheetByName(CONFIG.SHEETS.CATEGORIES);
    if (!sheet || sheet.getLastRow() > 1) return;

    const categories = [
      ['CAT-01', 'Miniket Rice (মিনিকেট)', 'miniket', true, 1],
      ['CAT-02', 'Gobindobhog Rice (গোবিন্দভোগ)', 'gobindobhog', true, 2],
      ['CAT-03', 'Ratna & Swarna Daily Rice (রত্না / স্বর্ণা)', 'ratna-swarna', true, 3],
      ['CAT-04', 'Banskathi Rice (বাঁশকাঠি)', 'banskathi', true, 4],
      ['CAT-05', 'Dudheshwar Fine Rice (দুধেশ্বর)', 'dudheshwar', true, 5],
      ['CAT-06', 'Dehradun Basmati Rice (দেরাদুন বাসমতী)', 'basmati', true, 6]
    ];

    sheet.getRange(2, 1, categories.length, categories[0].length).setValues(categories);
    Logger.log(' -> Seeded CATEGORIES table with 6 staple rice categories.');
  }
}
