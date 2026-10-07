/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - DemoDataSeeder.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Master Hyperlocal Demo Data Seeder and Isolated Test Sandbox.
 * Creates realistic Kolkata rice listings, local Garia merchants, delivery riders,
 * active orders, and customer reviews. All records strictly tagged with DEMO_.
 * Includes safe clearDemoData() routine that leaves real records intact.
 */

/**
 * Top-level runner: Seeds isolated demo data into the marketplace.
 * Select 'seedDemoData' from the Apps Script editor toolbar and click 'Run'.
 */
function seedDemoData() {
  return DemoDataSeeder.seed();
}

/**
 * Top-level runner: Safely purges only DEMO_ tagged records from all sheets.
 * Select 'clearDemoData' from the Apps Script editor toolbar and click 'Run'.
 */
function clearDemoData() {
  return DemoDataSeeder.clear();
}

class DemoDataSeeder {
  /**
   * Master seeder routine.
   * Clears old demo data first to guarantee idempotency, then populates fresh records.
   */
  static seed() {
    Logger.log('================================================================');
    Logger.log('🌾 SEEDING HYPERLOCAL DEMO DATA FOR GARIA RICE MARKETPLACE™');
    Logger.log('================================================================');

    // 1. Ensure database sheets exist
    if (typeof SetupMarketplace !== 'undefined') {
      SetupMarketplace.initialize();
    }

    // 2. Clear existing demo data to prevent duplicates
    this.clear();

    const ss = SheetService.getSpreadsheet();
    const nowIso = new Date().toISOString();

    // 3. Seed Demo Users & Authentication Records
    this.seedUsers_(ss, nowIso);

    // 4. Seed Demo Sellers in Garia Localities
    this.seedSellers_(ss, nowIso);

    // 5. Seed Demo Rice Catalog across Pack Sizes
    this.seedProducts_(ss, nowIso);

    // 6. Seed Demo Delivery Partners
    this.seedRiders_(ss, nowIso);

    // 7. Seed Demo Customers
    this.seedCustomers_(ss, nowIso);

    // 8. Seed Progressive Lifecycle Orders
    this.seedOrders_(ss, nowIso);

    // 9. Seed Verified Customer Reviews
    this.seedReviews_(ss, nowIso);

    // 10. Invalidate ORM cache
    SheetService.clearCache();

    Logger.log('================================================================');
    Logger.log('🌾 DEMO DATA SEEDED SUCCESSFULLY! ALL TEST RECORDS READY.');
    Logger.log('Open your Web App URL to test comparison, ordering, and portals.');
    Logger.log('================================================================');

    return {
      success: true,
      message: 'Demo data seeded successfully. All records prefixed with DEMO_.'
    };
  }

  /**
   * Safely purges only records whose primary key begins with 'DEMO_'.
   * Never deletes sheet headers or real customer transactions.
   */
  static clear() {
    Logger.log('[DemoDataSeeder.clear] Purging existing DEMO_ records...');

    const ss = SheetService.getSpreadsheet();
    const targetSheets = [
      CONFIG.SHEETS.USERS,
      CONFIG.SHEETS.CUSTOMERS,
      CONFIG.SHEETS.SELLERS,
      CONFIG.SHEETS.PRODUCTS,
      CONFIG.SHEETS.PRODUCT_IMAGES,
      CONFIG.SHEETS.ORDERS,
      CONFIG.SHEETS.ORDER_ITEMS,
      CONFIG.SHEETS.ORDER_STATUS_LOG,
      CONFIG.SHEETS.DELIVERY_PARTNERS,
      CONFIG.SHEETS.DELIVERY_ASSIGNMENTS,
      CONFIG.SHEETS.REVIEWS,
      CONFIG.SHEETS.FACEBOOK_DRAFTS
    ];

    let totalPurged = 0;

    for (const sheetName of targetSheets) {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() <= 1) continue;

      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

      // Filter out rows that begin with DEMO_ in Column A
      const preservedRows = data.filter(row => {
        const primaryKey = String(row[0] || '').trim();
        return !primaryKey.startsWith('DEMO_');
      });

      const purgedInSheet = data.length - preservedRows.length;
      totalPurged += purgedInSheet;

      // Clear existing data rows below header
      sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();

      // Write back preserved production records
      if (preservedRows.length > 0) {
        sheet.getRange(2, 1, preservedRows.length, lastCol).setValues(preservedRows);
      }
    }

    SheetService.clearCache();
    Logger.log('[DemoDataSeeder.clear] Total DEMO_ records purged: ' + totalPurged);
    return { success: true, purged_count: totalPurged };
  }

  /**
   * Internal Seeder: USERS table.
   * @private
   */
  static seedUsers_(ss, nowIso) {
    const dummyHash = SecurityService.hashToken('DEMO_SESSION_TOKEN_12345');
    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const users = [
      // Sellers
      ['DEMO_USR_SLR_001', CONFIG.ROLES.SELLER, '9830011111', 'annapurna@gariarice.in', dummyHash, futureExpiry, 'ACTIVE', nowIso, nowIso],
      ['DEMO_USR_SLR_002', CONFIG.ROLES.SELLER, '9830022222', 'patuli@gariarice.in', dummyHash, futureExpiry, 'ACTIVE', nowIso, nowIso],
      ['DEMO_USR_SLR_003', CONFIG.ROLES.SELLER, '9830033333', 'mahatara@gariarice.in', dummyHash, futureExpiry, 'ACTIVE', nowIso, nowIso],
      // Riders
      ['DEMO_USR_RDR_001', CONFIG.ROLES.RIDER, '9830044444', 'rider1@gariarice.in', dummyHash, futureExpiry, 'ACTIVE', nowIso, nowIso],
      ['DEMO_USR_RDR_002', CONFIG.ROLES.RIDER, '9830055555', 'rider2@gariarice.in', dummyHash, futureExpiry, 'ACTIVE', nowIso, nowIso],
      // Customers
      ['DEMO_USR_CST_001', CONFIG.ROLES.CUSTOMER, '9830066666', 'customer1@gmail.com', dummyHash, futureExpiry, 'ACTIVE', nowIso, nowIso],
      ['DEMO_USR_CST_002', CONFIG.ROLES.CUSTOMER, '9830077777', 'customer2@gmail.com', dummyHash, futureExpiry, 'ACTIVE', nowIso, nowIso]
    ];

    const sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
    sheet.getRange(sheet.getLastRow() + 1, 1, users.length, users[0].length).setValues(users);
  }

  /**
   * Internal Seeder: SELLERS table.
   * @private
   */
  static seedSellers_(ss, nowIso) {
    const operatingHours = JSON.stringify({ open: '08:00', close: '21:30' });

    const sellers = [
      [
        'DEMO_SLR_001', 'DEMO_USR_SLR_001', 'Annapurna Rice Bhandar', 'Debabrata Ghosh',
        '9830011111', '9830011111', 'annapurna@gariarice.in',
        'Shop 4, Garia Station Market Road', 'Garia Station', '700084',
        22.4632, 88.3912, 3.5,
        '12822019000123', true, operatingHours, true,
        4.8, 48, CONFIG.APPROVAL_STATUS.APPROVED, 7.0, nowIso, nowIso
      ],
      [
        'DEMO_SLR_002', 'DEMO_USR_SLR_002', 'Patuli Modern Rice Agency', 'Swapan Kumar Paul',
        '9830022222', '9830022222', 'patuli@gariarice.in',
        'Block H, Near Floating Market', 'Baishnabghata Patuli', '700094',
        22.4740, 88.3840, 4.0,
        '12822019000456', true, operatingHours, true,
        4.6, 32, CONFIG.APPROVAL_STATUS.APPROVED, 7.0, nowIso, nowIso
      ],
      [
        'DEMO_SLR_003', 'DEMO_USR_SLR_003', 'Maa Tara Chal Bhandar', 'Subir Biswas',
        '9830033333', '9830033333', 'mahatara@gariarice.in',
        '88 Garia Main Road, Hindustan More', 'Mahamayatala', '700050',
        22.4510, 88.3890, 3.0,
        '12822019000789', true, operatingHours, true,
        4.7, 26, CONFIG.APPROVAL_STATUS.APPROVED, 7.0, nowIso, nowIso
      ]
    ];

    const sheet = ss.getSheetByName(CONFIG.SHEETS.SELLERS);
    sheet.getRange(sheet.getLastRow() + 1, 1, sellers.length, sellers[0].length).setValues(sellers);
  }

  /**
   * Internal Seeder: PRODUCTS & PRODUCT_IMAGES tables.
   * Competing Miniket prices allow live comparison matrix validation.
   * @private
   */
  static seedProducts_(ss, nowIso) {
    const products = [
      // Seller 1 (Annapurna Rice Bhandar - Garia Station)
      [
        'DEMO_PRD_001', 'DEMO_SLR_001', 'Miniket Rice (Burdwan Mill Fresh)', 'মিনিকেট চাল',
        'Miniket', 'Annapurna Classic', CONFIG.GRAIN_TYPES.PARBOILED, 25.0,
        CONFIG.PACK_FORMATS.SINGLE_BAG, 1390.0, 1450.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, 'Slender, polished daily parboiled Miniket rice from Burdwan. Free from dust and stones.',
        'Burdwan, WB', true, nowIso, nowIso
      ],
      [
        'DEMO_PRD_002', 'DEMO_SLR_001', 'Gobindobhog Aromatic Rice (Specialty Pack)', 'গোবیندভোগ চাল',
        'Gobindobhog', 'Annapurna Kheer Special', CONFIG.GRAIN_TYPES.AROMATIC, 2.0,
        CONFIG.PACK_FORMATS.SINGLE_BAG, 280.0, 320.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, 'Rich aromatic small-grain Gobindobhog rice from Nadia. Perfect for payesh and khichuri.',
        'Nadia, WB', true, nowIso, nowIso
      ],
      [
        'DEMO_PRD_003', 'DEMO_SLR_001', 'Gobindobhog Rice (Family Feast Pack)', 'গোবیندভোগ চাল',
        'Gobindobhog', 'Annapurna Kheer Special', CONFIG.GRAIN_TYPES.AROMATIC, 5.0,
        CONFIG.PACK_FORMATS.SINGLE_BAG, 680.0, 750.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, '5kg value bag of fragrant premium Gobindobhog rice.',
        'Nadia, WB', false, nowIso, nowIso
      ],
      [
        'DEMO_PRD_004', 'DEMO_SLR_001', 'Ratna Daily Parboiled Rice', 'রত্না চাল',
        'Ratna', 'Local Mill Selection', CONFIG.GRAIN_TYPES.PARBOILED, 25.0,
        CONFIG.PACK_FORMATS.SINGLE_BAG, 1180.0, 1250.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, 'Affordable, medium-grain daily parboiled rice for regular household meals.',
        'Midnapore, WB', false, nowIso, nowIso
      ],

      // Seller 2 (Patuli Modern Rice Agency - Competing Miniket)
      [
        'DEMO_PRD_005', 'DEMO_SLR_002', 'Miniket Rice (Selected Premium Boil)', 'মিনিকেট চাল',
        'Miniket', 'Shree Krishna Brand', CONFIG.GRAIN_TYPES.PARBOILED, 25.0,
        CONFIG.PACK_FORMATS.SINGLE_BAG, 1350.0, 1420.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, 'Well-milled long grain Miniket rice. High cooking yield and non-sticky texture.',
        'Burdwan, WB', true, nowIso, nowIso
      ],
      [
        'DEMO_PRD_006', 'DEMO_SLR_002', 'Banskathi Super Fine Rice', 'বাঁশকাঠি চাল',
        'Banskathi', 'Royal Bengal Gold', CONFIG.GRAIN_TYPES.PARBOILED, 25.0,
        CONFIG.PACK_FORMATS.SINGLE_BAG, 1550.0, 1650.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, 'Extra-long slender grain Banskathi rice. Light on digestion, ideal for table rice.',
        'Burdwan, WB', true, nowIso, nowIso
      ],
      [
        'DEMO_PRD_007', 'DEMO_SLR_002', 'Dudheshwar Fine Atap Rice', 'দুধেশ্বর চাল (আতপ)',
        'Dudheshwar', 'Shree Krishna Atap', CONFIG.GRAIN_TYPES.RAW, 10.0,
        CONFIG.PACK_FORMATS.SINGLE_BAG, 720.0, 780.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, 'Traditional Bengal raw Atap rice with distinct natural aroma.',
        'Hooghly, WB', false, nowIso, nowIso
      ],
      [
        'DEMO_PRD_008', 'DEMO_SLR_002', 'Miniket Family Bulk Bag (25kg x 2)', 'মিনিকেট চাল ৫০ কেজি',
        'Miniket', 'Shree Krishna Brand', CONFIG.GRAIN_TYPES.PARBOILED, 50.0,
        CONFIG.PACK_FORMATS.DUAL_25KG_BAGS, 2680.0, 2800.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, 'Double 25kg packaging for easier household handling. Great wholesale value.',
        'Burdwan, WB', false, nowIso, nowIso
      ],

      // Seller 3 (Maa Tara Chal Bhandar - Mahamayatala)
      [
        'DEMO_PRD_009', 'DEMO_SLR_003', 'Miniket Rice (Grade-A Sortex Cleaned)', 'মিনিকেট চাল',
        'Miniket', 'Maa Tara Select', CONFIG.GRAIN_TYPES.PARBOILED, 25.0,
        CONFIG.PACK_FORMATS.SINGLE_BAG, 1420.0, 1480.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, 'Double-sortex cleaned 100% whole grain Miniket rice. Zero broken grains.',
        'Burdwan, WB', true, nowIso, nowIso
      ],
      [
        'DEMO_PRD_010', 'DEMO_SLR_003', 'Dehradun Basmati Rice (Royal Aromatic)', 'দেরাদুন বাসমতী চাল',
        'Basmati', 'Himalayan Crown', CONFIG.GRAIN_TYPES.AROMATIC, 5.0,
        CONFIG.PACK_FORMATS.SINGLE_BAG, 620.0, 720.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, 'Aged royal Basmati rice with exquisite grain elongation for Biryani and Pulao.',
        'Dehradun, India', false, nowIso, nowIso
      ],
      [
        'DEMO_PRD_011', 'DEMO_SLR_003', 'Swarna Parboiled Everyday Rice', 'স্বর্ণা চাল',
        'Swarna', 'Maa Tara Daily', CONFIG.GRAIN_TYPES.PARBOILED, 25.0,
        CONFIG.PACK_FORMATS.SINGLE_BAG, 1150.0, 1200.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, 'Nutritious Swarna rice with wholesome cooking texture for daily consumption.',
        'Bankura, WB', false, nowIso, nowIso
      ],
      [
        'DEMO_PRD_012', 'DEMO_SLR_003', 'Miniket Single 50kg Mill Bag', 'মিনিকেট চাল ৫০ কেজি',
        'Miniket', 'Maa Tara Select', CONFIG.GRAIN_TYPES.PARBOILED, 50.0,
        CONFIG.PACK_FORMATS.SINGLE_BAG, 2790.0, 2900.0, CONFIG.STOCK_STATUS.IN_STOCK,
        true, CONFIG.APPROVAL_STATUS.APPROVED, 'Heavy single 50kg bag direct from mill. Delivery via Cargo Toto.',
        'Burdwan, WB', false, nowIso, nowIso
      ]
    ];

    const sheet = ss.getSheetByName(CONFIG.SHEETS.PRODUCTS);
    sheet.getRange(sheet.getLastRow() + 1, 1, products.length, products[0].length).setValues(products);

    // Seed default product images
    const defaultImgUrl = 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=600&q=80';
    const images = products.map((p, idx) => [
      'DEMO_IMG_' + (idx + 1),
      p[0],
      defaultImgUrl,
      true,
      1,
      nowIso
    ]);

    const imgSheet = ss.getSheetByName(CONFIG.SHEETS.PRODUCT_IMAGES);
    imgSheet.getRange(imgSheet.getLastRow() + 1, 1, images.length, images[0].length).setValues(images);
  }

  /**
   * Internal Seeder: DELIVERY_PARTNERS table.
   * @private
   */
  static seedRiders_(ss, nowIso) {
    const zones = JSON.stringify(['ZONE-GARIA-01', 'ZONE-GARIA-02', 'ZONE-GARIA-03']);

    const riders = [
      [
        'DEMO_RDR_001', 'DEMO_USR_RDR_001', 'Raju Mondal (Bicycle Courier)', '9830044444',
        'CYCLE', 25.0, zones, 'AVAILABLE', 'APPROVED', 4.9, 124, nowIso, nowIso
      ],
      [
        'DEMO_RDR_002', 'DEMO_USR_RDR_002', 'Kartick Halder (Motorcycle Courier)', '9830055555',
        'MOTORCYCLE', 60.0, zones, 'AVAILABLE', 'APPROVED', 4.8, 86, nowIso, nowIso
      ]
    ];

    const sheet = ss.getSheetByName(CONFIG.SHEETS.DELIVERY_PARTNERS);
    sheet.getRange(sheet.getLastRow() + 1, 1, riders.length, riders[0].length).setValues(riders);
  }

  /**
   * Internal Seeder: CUSTOMERS table.
   * @private
   */
  static seedCustomers_(ss, nowIso) {
    const addressesCust1 = JSON.stringify([
      {
        address_id: 'DEMO_ADDR_1',
        label: 'Home',
        address_line: 'Flat 3B, Kanungo Park',
        landmark: 'Near Kavi Nazrul Metro',
        locality: 'Garia Station Road',
        pincode: '700084',
        is_default: true
      }
    ]);

    const addressesCust2 = JSON.stringify([
      {
        address_id: 'DEMO_ADDR_2',
        label: 'Home',
        address_line: 'House 42, Block D, Baishnabghata',
        landmark: 'Opposite Satyajit Ray Park',
        locality: 'Baishnabghata Patuli',
        pincode: '700094',
        is_default: true
      }
    ]);

    const customers = [
      [
        'DEMO_CST_001', 'DEMO_USR_CST_001', 'Sourav Mukherjee', '9830066666',
        '9830066666', addressesCust1, 'ZONE-GARIA-01', 2, nowIso, nowIso
      ],
      [
        'DEMO_CST_002', 'DEMO_USR_CST_002', 'Ananya Banerjee', '9830077777',
        '9830077777', addressesCust2, 'ZONE-GARIA-02', 1, nowIso, nowIso
      ]
    ];

    const sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    sheet.getRange(sheet.getLastRow() + 1, 1, customers.length, customers[0].length).setValues(customers);
  }

  /**
   * Internal Seeder: ORDERS, ORDER_ITEMS, and ORDER_STATUS_LOG tables.
   * Creates 3 orders demonstrating progressive lifecycle milestones.
   * @private
   */
  static seedOrders_(ss, nowIso) {
    const cust1Addr = JSON.stringify({
      address_line: 'Flat 3B, Kanungo Park',
      landmark: 'Near Kavi Nazrul Metro',
      locality: 'Garia Station Road',
      pincode: '700084'
    });

    const cust2Addr = JSON.stringify({
      address_line: 'House 42, Block D, Baishnabghata',
      landmark: 'Opposite Satyajit Ray Park',
      locality: 'Baishnabghata Patuli',
      pincode: '700094'
    });

    const orders = [
      // Order 1: DELIVERED (Eligible for Review)
      [
        'DEMO_ORD_001', 'DEMO_CST_001', 'DEMO_SLR_001', CONFIG.ORDER_STATUS.DELIVERED,
        1390.0, 25.0, 0.0, 1415.0, 97.30, 1292.70, 20.0, 25.0,
        cust1Addr, 'Garia Station Road', 0.8,
        CONFIG.PAYMENT_METHODS.COD, CONFIG.PAYMENT_STATUS.COLLECTED, nowIso, nowIso
      ],
      // Order 2: READY_FOR_PICKUP (Visible in Rider Job Broadcast Feed)
      [
        'DEMO_ORD_002', 'DEMO_CST_002', 'DEMO_SLR_002', CONFIG.ORDER_STATUS.READY_FOR_PICKUP,
        1550.0, 35.0, 0.0, 1585.0, 108.50, 1441.50, 28.0, 25.0,
        cust2Addr, 'Baishnabghata Patuli', 2.2,
        CONFIG.PAYMENT_METHODS.COD, CONFIG.PAYMENT_STATUS.PENDING, nowIso, nowIso
      ],
      // Order 3: PLACED (Visible in Seller Dashboard Incoming Orders)
      [
        'DEMO_ORD_003', 'DEMO_CST_001', 'DEMO_SLR_003', CONFIG.ORDER_STATUS.PLACED,
        1420.0, 30.0, 0.0, 1450.0, 99.40, 1320.60, 24.0, 25.0,
        cust1Addr, 'Garia Station Road', 1.8,
        CONFIG.PAYMENT_METHODS.COD, CONFIG.PAYMENT_STATUS.PENDING, nowIso, nowIso
      ]
    ];

    const orderSheet = ss.getSheetByName(CONFIG.SHEETS.ORDERS);
    orderSheet.getRange(orderSheet.getLastRow() + 1, 1, orders.length, orders[0].length).setValues(orders);

    // Seed Order Line Items
    const items = [
      ['DEMO_ITM_001', 'DEMO_ORD_001', 'DEMO_PRD_001', 'Miniket Rice (Burdwan Mill Fresh)', 'Miniket', 25.0, 1390.0, 1, 1390.0],
      ['DEMO_ITM_002', 'DEMO_ORD_002', 'DEMO_PRD_006', 'Banskathi Super Fine Rice', 'Banskathi', 25.0, 1550.0, 1, 1550.0],
      ['DEMO_ITM_003', 'DEMO_ORD_003', 'DEMO_PRD_009', 'Miniket Rice (Grade-A Sortex Cleaned)', 'Miniket', 25.0, 1420.0, 1, 1420.0]
    ];

    const itemSheet = ss.getSheetByName(CONFIG.SHEETS.ORDER_ITEMS);
    itemSheet.getRange(itemSheet.getLastRow() + 1, 1, items.length, items[0].length).setValues(items);

    // Seed Order Status Logs
    const logs = [
      ['DEMO_LOG_001', 'DEMO_ORD_001', '', 'PLACED', 'DEMO_CST_001', 'CUSTOMER', 'Order placed', nowIso],
      ['DEMO_LOG_002', 'DEMO_ORD_001', 'PLACED', 'SELLER_CONFIRMED', 'DEMO_SLR_001', 'SELLER', 'Order confirmed', nowIso],
      ['DEMO_LOG_003', 'DEMO_ORD_001', 'SELLER_CONFIRMED', 'DELIVERED', 'DEMO_RDR_001', 'RIDER', 'Delivered at doorstep', nowIso],
      ['DEMO_LOG_004', 'DEMO_ORD_002', '', 'PLACED', 'DEMO_CST_002', 'CUSTOMER', 'Order placed', nowIso],
      ['DEMO_LOG_005', 'DEMO_ORD_002', 'PLACED', 'READY_FOR_PICKUP', 'DEMO_SLR_002', 'SELLER', 'Packed and ready', nowIso],
      ['DEMO_LOG_006', 'DEMO_ORD_003', '', 'PLACED', 'DEMO_CST_001', 'CUSTOMER', 'Order placed', nowIso]
    ];

    const logSheet = ss.getSheetByName(CONFIG.SHEETS.ORDER_STATUS_LOG);
    logSheet.getRange(logSheet.getLastRow() + 1, 1, logs.length, logs[0].length).setValues(logs);

    // Seed Delivery Assignment for Order 2 (Ready for pickup broadcast)
    const assignments = [
      ['DEMO_ASN_001', 'DEMO_ORD_001', 'DEMO_RDR_001', 'COMPLETED', nowIso, nowIso, nowIso, nowIso, 20.0],
      ['DEMO_ASN_002', 'DEMO_ORD_002', '', 'DISPATCHED', nowIso, '', '', '', 28.0]
    ];

    const asnSheet = ss.getSheetByName(CONFIG.SHEETS.DELIVERY_ASSIGNMENTS);
    asnSheet.getRange(asnSheet.getLastRow() + 1, 1, assignments.length, assignments[0].length).setValues(assignments);
  }

  /**
   * Internal Seeder: REVIEWS table.
   * @private
   */
  static seedReviews_(ss, nowIso) {
    const reviews = [
      [
        'DEMO_REV_001', 'DEMO_ORD_001', 'DEMO_CST_001', 'DEMO_SLR_001', 'DEMO_PRD_001',
        5, 5, 5,
        'Excellent Miniket rice! The grains are long, unbroken, and fresh from Burdwan mill. Delivery was completed in 40 minutes to Kanungo Park.',
        CONFIG.APPROVAL_STATUS.APPROVED, true, nowIso, nowIso
      ]
    ];

    const sheet = ss.getSheetByName(CONFIG.SHEETS.REVIEWS);
    sheet.getRange(sheet.getLastRow() + 1, 1, reviews.length, reviews[0].length).setValues(reviews);
  }
}
