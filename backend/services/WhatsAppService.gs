/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - WhatsAppService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * WhatsApp Integration Engine & Zero-Cost Click-to-Chat Generator.
 * Conforms strictly to Sections 34 & 62: Zero faking of automated delivery.
 * Generates pre-filled, URL-encoded wa.me links for customer tracking, viral
 * product sharing, and merchant dispatch, with Phase-2 Cloud API abstraction.
 */

class WhatsAppService {
  /**
   * Constructs a standard, URL-encoded WhatsApp Click-to-Chat link.
   * Format: https://wa.me/91XXXXXXXXXX?text=URL_ENCODED_MESSAGE
   * @param {string} phone - Indian mobile number (e.g. '9830012345').
   * @param {string} rawMessage - Plain text message with emojis and line breaks.
   * @return {string} Valid clickable WhatsApp URL.
   */
  static buildClickToChatUrl(phone, rawMessage) {
    const cleanPhone = SecurityService.normalizeIndianPhone(phone);
    if (!cleanPhone) {
      Logger.log('[WhatsAppService.buildClickToChatUrl] Warning: Invalid phone number [' + phone + ']. Falling back to support number.');
      const fallbackPhone = SecurityService.normalizeIndianPhone(CONFIG.APP.SUPPORT_PHONE) || '919830000000';
      return 'https://wa.me/91' + fallbackPhone + '?text=' + encodeURIComponent(rawMessage || '');
    }

    // Prefix with India country code 91
    const intlPhone = '91' + cleanPhone;
    const encodedText = encodeURIComponent(String(rawMessage || '').trim());

    return 'https://wa.me/' + intlPhone + '?text=' + encodedText;
  }

  /**
   * Generates customer order tracking WhatsApp message and link.
   * Used for customer self-service tracking and order confirmation.
   * @param {Object} order - Order record from ORDERS table.
   * @param {Object} [seller=null] - Seller record from SELLERS table.
   * @return {Object} { url, message_text, mode, automated_sent: false }
   */
  static generateOrderTrackingLink(order, seller = null) {
    const orderId = order.order_id;
    const totalAmount = order.total_amount_inr;
    const sellerName = seller ? seller.business_name : 'Local Rice Merchant';
    const locality = order.delivery_locality || 'Garia';
    const curr = CONFIG.APP.CURRENCY_SYMBOL || '₹';

    const message = 
      '🌾 *GARIA RICE MARKETPLACE™*\n' +
      'Order Update: *' + orderId + '*\n' +
      '--------------------------------\n' +
      'Delivered Total: *' + curr + totalAmount + '* (COD/UPI)\n' +
      'Seller: ' + sellerName + '\n' +
      'Delivery Locality: ' + locality + '\n' +
      'Status: *' + order.current_status + '*\n\n' +
      'Track your order timeline live:\n' +
      'https://www.gariarice.in/#/order/' + orderId;

    const targetPhone = order.customer_phone || (seller ? seller.whatsapp_phone : '');
    const url = this.buildClickToChatUrl(targetPhone, message);

    return {
      channel: 'WHATSAPP_CLICK_TO_CHAT',
      target_phone: targetPhone,
      message_text: message,
      url: url,
      mode: 'MANUAL_LINK',
      automated_sent: false
    };
  }

  /**
   * Viral Product Sharing: Generates prefilled WhatsApp text for sharing rice deals.
   * Conforms strictly to Section 20.
   * @param {Object} product - Product record { name_en, pack_size_kg, price_inr, variety }.
   * @param {string} [sellerName='Local Garia Seller'] - Merchant business name.
   * @param {number} [deliveryFee=25] - Estimated delivery fee.
   * @return {string} Clickable WhatsApp share URL.
   */
  static generateProductShareLink(product, sellerName = 'Local Garia Seller', deliveryFee = 25) {
    const curr = CONFIG.APP.CURRENCY_SYMBOL || '₹';
    const ricePrice = parseFloat(product.price_inr) || 0;
    const totalDelivered = ricePrice + deliveryFee;
    const productName = product.name_en || (product.pack_size_kg + 'kg ' + product.variety + ' Rice');

    const shareText =
      '🌾 *Check this rice deal on Garia Rice Marketplace™:*\n\n' +
      '*' + productName + '* (' + (product.pack_size_kg || 25) + ' kg bag)\n' +
      'Rice Price: ' + curr + ricePrice + '\n' +
      'Delivery: ' + curr + deliveryFee + '\n' +
      '*Total Delivered: ' + curr + totalDelivered + '*\n\n' +
      'Seller: ' + sellerName + '\n' +
      'Order fresh local rice here:\n' +
      'https://www.gariarice.in/#/product/' + product.product_id;

    // Empty recipient phone opens WhatsApp contact selector
    return 'https://api.whatsapp.com/send?text=' + encodeURIComponent(shareText);
  }

  /**
   * Generates direct support WhatsApp link for customer help.
   * @param {string} [orderId=null] - Optional Order ID for context.
   * @return {string} Clickable WhatsApp support URL.
   */
  static generateCustomerSupportLink(orderId = null) {
    const supportPhone = CONFIG.APP.SUPPORT_PHONE || '9830000000';
    let message = 'Hello Garia Rice Marketplace, I need assistance with an inquiry.';

    if (orderId) {
      message = 'Hello Support, I have a question regarding my order: *' + orderId + '*.';
    }

    return this.buildClickToChatUrl(supportPhone, message);
  }

  /**
   * Generates pre-filled coordination message between rider and seller shop.
   * @param {string} sellerPhone - Merchant phone.
   * @param {string} orderId - Order ID.
   * @param {string} riderName - Courier name.
   * @return {string} Clickable WhatsApp URL.
   */
  static generateRiderCoordinationLink(sellerPhone, orderId, riderName) {
    const message =
      'Hello, I am ' + riderName + ' (Delivery Partner). I have arrived to pick up Order: *' + orderId + '*. Please have the rice bags ready.';

    return this.buildClickToChatUrl(sellerPhone, message);
  }

  /**
   * Phase-2 Provider Abstraction Engine (Meta Cloud API / Twilio).
   * For MVP: Returns structured MANUAL_LINK DTO without claiming automated send.
   * For Phase 2: Dispatches HTTP request via UrlFetchApp if credentials configured.
   * @param {string} toPhone - Recipient phone number.
   * @param {string} messageText - Message text.
   * @return {Object} Standardized transmission result envelope.
   */
  static sendAutomatedMessage(toPhone, messageText) {
    const provider = AppConfig.get('WHATSAPP_PROVIDER', 'CLICK_TO_CHAT');

    // 1. MVP Default Driver: Zero-cost manual click-to-chat URL
    if (provider === 'CLICK_TO_CHAT') {
      const url = this.buildClickToChatUrl(toPhone, messageText);
      return {
        success: true,
        provider: 'CLICK_TO_CHAT',
        automated_sent: false,
        delivery_status: 'STAGED_LINK',
        url: url,
        message: 'WhatsApp click-to-chat link staged. Automated background dispatch not configured in MVP mode.'
      };
    }

    // 2. Phase-2 Meta WhatsApp Cloud API Driver (Plug-in interface)
    if (provider === 'META_CLOUD_API') {
      const apiKey = AppConfig.get('WHATSAPP_API_KEY', '');
      const phoneNumberId = AppConfig.get('WHATSAPP_PHONE_NUMBER_ID', '');

      if (!apiKey || !phoneNumberId) {
        Logger.log('[WhatsAppService.sendAutomatedMessage] Meta Cloud API credentials missing in Script Properties.');
        return {
          success: false,
          provider: 'META_CLOUD_API',
          automated_sent: false,
          delivery_status: 'FAILED',
          error: 'Missing WhatsApp Cloud API credentials in configuration.'
        };
      }

      try {
        const cleanPhone = SecurityService.normalizeIndianPhone(toPhone);
        const endpoint = 'https://graph.facebook.com/v18.0/' + phoneNumberId + '/messages';
        const payload = {
          messaging_product: 'whatsapp',
          to: '91' + cleanPhone,
          type: 'text',
          text: { body: messageText }
        };

        const response = UrlFetchApp.fetch(endpoint, {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + apiKey },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        const statusCode = response.getResponseCode();
        const responseJson = JSON.parse(response.getContentText() || '{}');

        if (statusCode >= 200 && statusCode < 300) {
          return {
            success: true,
            provider: 'META_CLOUD_API',
            automated_sent: true,
            delivery_status: 'SENT',
            message_id: responseJson.messages ? responseJson.messages[0].id : '',
            raw_response: responseJson
          };
        } else {
          return {
            success: false,
            provider: 'META_CLOUD_API',
            automated_sent: false,
            delivery_status: 'FAILED',
            error: responseJson.error ? responseJson.error.message : 'HTTP ' + statusCode
          };
        }

      } catch (err) {
        Logger.log('[WhatsAppService.sendAutomatedMessage] Outbound Cloud API error: ' + err.message);
        return {
          success: false,
          provider: 'META_CLOUD_API',
          automated_sent: false,
          delivery_status: 'FAILED',
          error: err.message
        };
      }
    }

    return {
      success: false,
      provider: provider,
      automated_sent: false,
      delivery_status: 'FAILED',
      error: 'Unsupported WhatsApp provider: ' + provider
    };
  }
}
