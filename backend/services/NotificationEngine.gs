/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - NotificationEngine.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Central Event-Driven Notification Orchestration Engine.
 * Manages transactional email delivery via GmailApp, WhatsApp click-to-chat link
 * staging, template token substitution, quota awareness, and audit logging.
 */

class NotificationEngine {
  /**
   * Replaces token placeholders {{key}} within a template string with actual values.
   * @param {string} template - String containing tokens (e.g., 'Hello {{customer_name}}').
   * @param {Object} dataMap - Key-value dictionary.
   * @return {string} Rendered text string.
   */
  static renderTemplate(template, dataMap = {}) {
    if (!template || typeof template !== 'string') {
      return '';
    }

    return template.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (match, key) => {
      const val = dataMap[key];
      return (val !== undefined && val !== null) ? String(val) : '';
    });
  }

  /**
   * Records a notification attempt into the NOTIFICATION_LOG sheet.
   * Failsafe: will not crash if logging encounters an issue.
   * @param {string} eventName - Triggering event name (e.g. 'ORDER_PLACED').
   * @param {string} recipientRole - CUSTOMER, SELLER, RIDER, ADMIN.
   * @param {string} recipientContact - Phone number or email.
   * @param {string} channel - 'EMAIL' or 'WHATSAPP_CLICK_TO_CHAT'.
   * @param {string} deliveryStatus - 'SENT', 'FAILED', or 'STAGED_LINK'.
   * @param {string} snippet - Short preview of message body.
   * @param {string} [errorDetails=''] - Error message if failed.
   */
  static logNotification_(eventName, recipientRole, recipientContact, channel, deliveryStatus, snippet, errorDetails = '') {
    try {
      const logRecord = {
        notification_id: SheetService.generateId('NLOG'),
        event_name: String(eventName).toUpperCase(),
        recipient_role: recipientRole || CONFIG.ROLES.CUSTOMER,
        recipient_contact: String(recipientContact || 'N/A').trim(),
        channel: channel,
        delivery_status: deliveryStatus,
        payload_snippet: String(snippet || '').substring(0, 255),
        error_details: String(errorDetails || '').substring(0, 255),
        timestamp: new Date().toISOString()
      };

      SheetService.insert(CONFIG.SHEETS.NOTIFICATION_LOG, logRecord);

    } catch (err) {
      Logger.log('[NotificationEngine.logNotification_] Warning: Failed to record notification log: ' + err.message);
    }
  }

  /**
   * Checks available daily Gmail quota to avoid quota exhaustion.
   * Consumer Gmail: ~100/day | Google Workspace: ~1,500/day.
   * @return {number} Remaining daily outbound email quota.
   */
  static getRemainingEmailQuota() {
    try {
      return MailApp.getRemainingDailyQuota();
    } catch (err) {
      Logger.log('[NotificationEngine.getRemainingEmailQuota] Error checking quota: ' + err.message);
      return 10; // Safe default estimate
    }
  }

  /**
   * Lifecycle Hook: Invoked when a new order is placed.
   * Coordinates merchant incoming order alert and customer confirmation.
   * @param {Object} order - Order record from ORDERS table.
   * @param {Object[]} [items=[]] - Array of order item objects.
   */
  static onOrderPlaced(order, items = []) {
    try {
      const seller = SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', order.seller_id);
      const customer = SheetService.findById(CONFIG.SHEETS.CUSTOMERS, 'customer_id', order.customer_id);

      const itemsSummary = items.length > 0
        ? items.map(i => i.quantity + 'x ' + (i.name || i.product_name) + ' (' + (i.pack_size_kg || 25) + 'kg)').join(', ')
        : 'Rice Order';

      const dataMap = {
        order_id: order.order_id,
        customer_name: customer ? customer.full_name : 'Customer',
        customer_locality: order.delivery_locality || 'Garia',
        seller_name: seller ? seller.business_name : 'Merchant',
        items_summary: itemsSummary,
        total_amount: order.total_amount_inr,
        seller_payout: order.seller_payout_inr,
        order_time: Utilities.formatDate(new Date(order.created_at || new Date()), CONFIG.APP.TIMEZONE, 'dd MMM yyyy, hh:mm a')
      };

      // 1. Dispatch Email to Seller (if seller has configured email)
      if (seller && seller.email) {
        if (typeof EmailService !== 'undefined' && typeof EmailService.sendSellerNewOrderEmail === 'function') {
          const sent = EmailService.sendSellerNewOrderEmail(seller.email, dataMap);
          this.logNotification_(
            'ORDER_PLACED',
            CONFIG.ROLES.SELLER,
            seller.email,
            'EMAIL',
            sent ? 'SENT' : 'FAILED',
            'New Order: ' + order.order_id + ' from ' + dataMap.customer_locality
          );
        }
      }

      // 2. Dispatch Email to Customer (if user has email)
      const user = customer ? SheetService.findById(CONFIG.SHEETS.USERS, 'user_id', customer.user_id) : null;
      if (user && user.email) {
        if (typeof EmailService !== 'undefined' && typeof EmailService.sendCustomerOrderPlacedEmail === 'function') {
          const sent = EmailService.sendCustomerOrderPlacedEmail(user.email, dataMap);
          this.logNotification_(
            'ORDER_PLACED',
            CONFIG.ROLES.CUSTOMER,
            user.email,
            'EMAIL',
            sent ? 'SENT' : 'FAILED',
            'Order Placed: ' + order.order_id + ' for ₹' + order.total_amount_inr
          );
        }
      }

      // 3. Stage WhatsApp Click-to-Chat Link for Customer (Strictly recorded as STAGED_LINK)
      if (typeof WhatsAppService !== 'undefined' && typeof WhatsAppService.generateOrderTrackingLink === 'function') {
        const waLink = WhatsAppService.generateOrderTrackingLink(order, seller);
        this.logNotification_(
          'ORDER_PLACED',
          CONFIG.ROLES.CUSTOMER,
          customer ? customer.primary_phone : 'N/A',
          'WHATSAPP_CLICK_TO_CHAT',
          'STAGED_LINK',
          'Prefilled WA tracking link generated for ' + order.order_id
        );
      }

    } catch (err) {
      Logger.log('[NotificationEngine.onOrderPlaced] Non-blocking exception: ' + err.message);
    }
  }

  /**
   * Lifecycle Hook: Invoked when order status changes in Finite State Machine.
   * Dispatches contextual milestone alerts (Confirmed, Out for Delivery, Delivered).
   * @param {Object} order - Order record.
   * @param {string} fromStatus - Previous status.
   * @param {string} toStatus - Destination status.
   */
  static onOrderStatusChange(order, fromStatus, toStatus) {
    try {
      const customer = SheetService.findById(CONFIG.SHEETS.CUSTOMERS, 'customer_id', order.customer_id);
      const user = customer ? SheetService.findById(CONFIG.SHEETS.USERS, 'user_id', customer.user_id) : null;
      const seller = SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', order.seller_id);

      const customerEmail = user ? user.email : '';
      const orderId = order.order_id;

      const dataMap = {
        order_id: orderId,
        customer_name: customer ? customer.full_name : 'Customer',
        seller_name: seller ? seller.business_name : 'Merchant',
        total_amount: order.total_amount_inr,
        status: toStatus
      };

      // Customer Status Email Dispatch
      if (customerEmail && typeof EmailService !== 'undefined' && typeof EmailService.sendCustomerStatusUpdateEmail === 'function') {
        const sent = EmailService.sendCustomerStatusUpdateEmail(customerEmail, toStatus, dataMap);
        this.logNotification_(
          'ORDER_STATUS_' + toStatus,
          CONFIG.ROLES.CUSTOMER,
          customerEmail,
          'EMAIL',
          sent ? 'SENT' : 'FAILED',
          'Order ' + orderId + ' status updated to ' + toStatus
        );
      }

      // Delivery Review Request Trigger upon DELIVERED status
      if (toStatus === CONFIG.ORDER_STATUS.DELIVERED) {
        if (customerEmail && typeof EmailService !== 'undefined' && typeof EmailService.sendReviewRequestEmail === 'function') {
          const sent = EmailService.sendReviewRequestEmail(customerEmail, dataMap);
          this.logNotification_(
            'REVIEW_REQUEST',
            CONFIG.ROLES.CUSTOMER,
            customerEmail,
            'EMAIL',
            sent ? 'SENT' : 'FAILED',
            'Review request sent for order ' + orderId
          );
        }
      }

    } catch (err) {
      Logger.log('[NotificationEngine.onOrderStatusChange] Non-blocking exception: ' + err.message);
    }
  }

  /**
   * Lifecycle Hook: Invoked when admin approves a merchant account.
   * @param {Object} seller - Seller record from SELLERS table.
   */
  static onSellerApproved(seller) {
    try {
      if (!seller || !seller.email) return;

      const dataMap = {
        seller_name: seller.business_name,
        owner_name: seller.owner_name,
        locality: seller.locality,
        app_name: CONFIG.APP.NAME,
        support_email: CONFIG.APP.SUPPORT_EMAIL
      };

      if (typeof EmailService !== 'undefined' && typeof EmailService.sendSellerApprovalEmail === 'function') {
        const sent = EmailService.sendSellerApprovalEmail(seller.email, dataMap);
        this.logNotification_(
          'SELLER_APPROVED',
          CONFIG.ROLES.SELLER,
          seller.email,
          'EMAIL',
          sent ? 'SENT' : 'FAILED',
          'Merchant account approved: ' + seller.business_name
        );
      }

    } catch (err) {
      Logger.log('[NotificationEngine.onSellerApproved] Non-blocking exception: ' + err.message);
    }
  }
}
