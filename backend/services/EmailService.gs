/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - EmailService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Transactional HTML Email Rendering and GmailApp Dispatch Engine.
 * Features mobile-responsive inline templates, transparent price breakdowns,
 * direct order tracking CTAs, and quota-aware failsafe delivery.
 */

class EmailService {
  /**
   * Internal wrapper for GmailApp.sendEmail with quota checks and exception shielding.
   * @private
   * @param {string} to - Recipient email address.
   * @param {string} subject - Email subject line.
   * @param {string} htmlBody - Complete inline-styled HTML string.
   * @param {string} [plainText=''] - Plain text fallback for non-HTML clients.
   * @return {boolean} True if successfully sent, false if failed or quota exhausted.
   */
  static sendSafeEmail_(to, subject, htmlBody, plainText = '') {
    if (!to || typeof to !== 'string' || !to.includes('@')) {
      Logger.log('[EmailService.sendSafeEmail_] Aborted: Invalid recipient email: ' + to);
      return false;
    }

    try {
      const remainingQuota = MailApp.getRemainingDailyQuota();
      if (remainingQuota < 2) {
        Logger.log('[EmailService.sendSafeEmail_] WARNING: Daily Gmail quota exhausted (' + remainingQuota + ' remaining). Email skipped.');
        return false;
      }

      const senderName = CONFIG.APP.NAME || 'Garia Rice Marketplace™';
      const fallbackText = plainText || htmlBody.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();

      GmailApp.sendEmail(to.trim(), subject, fallbackText, {
        htmlBody: htmlBody,
        name: senderName
      });

      return true;

    } catch (err) {
      Logger.log('[EmailService.sendSafeEmail_] Transmission error to [' + to + ']: ' + err.message);
      return false;
    }
  }

  /**
   * Base mobile-responsive HTML email layout with inline CSS styles.
   * Fully compatible with Gmail, Apple Mail, and mobile email viewers.
   * @private
   * @param {string} headerTitle - Header banner title.
   * @param {string} bodyContent - Core HTML content body.
   * @return {string} Full HTML document.
   */
  static buildBaseHtmlLayout_(headerTitle, bodyContent) {
    const appName = CONFIG.APP.NAME;
    const supportEmail = CONFIG.APP.SUPPORT_EMAIL;
    const supportPhone = CONFIG.APP.SUPPORT_PHONE;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headerTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#212529;line-height:1.5;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f6f8;padding:24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e9ecef;">
          <!-- Top Brand Header -->
          <tr>
            <td style="background-color:#1b4332;padding:24px 28px;text-align:left;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.2px;">🌾 ${appName}</h1>
              <p style="margin:4px 0 0 0;color:#b7e4c7;font-size:12px;font-weight:400;">Hyperlocal Rice Marketplace — Garia, Kolkata</p>
            </td>
          </tr>
          <!-- Body Content Area -->
          <tr>
            <td style="padding:28px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Support & Legal Footer -->
          <tr>
            <td style="background-color:#f8f9fa;padding:20px 28px;border-top:1px solid #e9ecef;text-align:center;font-size:12px;color:#6c757d;">
              <p style="margin:0 0 8px 0;">Need help? Email <a href="mailto:${supportEmail}" style="color:#2d6a4f;text-decoration:none;font-weight:600;">${supportEmail}</a> or call ${supportPhone}</p>
              <p style="margin:0;color:#adb5bd;">Serving Garia Station, Patuli, Baishnabghata, Mahamayatala, Boral & Rajpur.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Merchant Notification: Incoming new order placed.
   * @param {string} sellerEmail - Merchant's registered email address.
   * @param {Object} orderData - Order tokens dictionary.
   * @return {boolean} Success status.
   */
  static sendSellerNewOrderEmail(sellerEmail, orderData) {
    const subject = `[New Order] ${orderData.order_id} received (${orderData.customer_locality})`;
    const curr = CONFIG.APP.CURRENCY_SYMBOL || '₹';

    const body = `
      <div style="background-color:#e8f5e9;border-left:4px solid #2d6a4f;padding:14px 16px;border-radius:4px;margin-bottom:20px;">
        <h2 style="margin:0 0 4px 0;color:#1b4332;font-size:18px;">New Rice Order Received!</h2>
        <p style="margin:0;color:#2d6a4f;font-size:14px;">Order ID: <strong>${orderData.order_id}</strong></p>
      </div>

      <p style="font-size:15px;margin-bottom:16px;">Hello <strong>${orderData.seller_name}</strong>,</p>
      <p style="font-size:14px;color:#495057;margin-bottom:16px;">A local customer has placed a new order for fulfillment:</p>

      <table width="100%" cellpadding="8" cellspacing="0" style="background-color:#f8f9fa;border-radius:6px;border:1px solid #dee2e6;font-size:14px;margin-bottom:20px;">
        <tr>
          <td style="color:#6c757d;width:35%;">Delivery Area:</td>
          <td style="font-weight:600;color:#212529;">${orderData.customer_locality}</td>
        </tr>
        <tr>
          <td style="color:#6c757d;">Ordered Items:</td>
          <td style="font-weight:600;color:#212529;">${orderData.items_summary}</td>
        </tr>
        <tr>
          <td style="color:#6c757d;">Order Total:</td>
          <td style="font-weight:600;color:#212529;">${curr}${orderData.total_amount}</td>
        </tr>
        <tr style="border-top:1px solid #dee2e6;">
          <td style="color:#2d6a4f;font-weight:600;">Your Net Payout:</td>
          <td style="font-weight:700;color:#1b4332;font-size:16px;">${curr}${orderData.seller_payout}</td>
        </tr>
      </table>

      <p style="font-size:13px;color:#6c757d;margin-bottom:24px;">Please open your merchant portal to confirm this order and mark it ready for pickup once packed.</p>

      <div style="text-align:center;margin-bottom:12px;">
        <a href="https://www.gariarice.in/#/seller/orders" style="display:inline-block;background-color:#1b4332;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">Open Seller Portal</a>
      </div>`;

    const html = this.buildBaseHtmlLayout_('New Order Received', body);
    return this.sendSafeEmail_(sellerEmail, subject, html);
  }

  /**
   * Customer Notification: Order confirmation upon placement.
   * @param {string} customerEmail - Customer's registered email address.
   * @param {Object} orderData - Order tokens dictionary.
   * @return {boolean} Success status.
   */
  static sendCustomerOrderPlacedEmail(customerEmail, orderData) {
    const subject = `Order Confirmed: ${orderData.order_id} — Garia Rice Marketplace`;
    const curr = CONFIG.APP.CURRENCY_SYMBOL || '₹';

    const body = `
      <div style="background-color:#e8f5e9;border-left:4px solid #2d6a4f;padding:14px 16px;border-radius:4px;margin-bottom:20px;">
        <h2 style="margin:0 0 4px 0;color:#1b4332;font-size:18px;">Order Placed Successfully!</h2>
        <p style="margin:0;color:#2d6a4f;font-size:14px;">Order ID: <strong>${orderData.order_id}</strong></p>
      </div>

      <p style="font-size:15px;margin-bottom:16px;">Hello <strong>${orderData.customer_name}</strong>,</p>
      <p style="font-size:14px;color:#495057;margin-bottom:16px;">Thank you for ordering rice from your local neighborhood merchant. Here is your order summary:</p>

      <table width="100%" cellpadding="8" cellspacing="0" style="background-color:#f8f9fa;border-radius:6px;border:1px solid #dee2e6;font-size:14px;margin-bottom:20px;">
        <tr>
          <td style="color:#6c757d;width:35%;">Seller:</td>
          <td style="font-weight:600;color:#212529;">${orderData.seller_name}</td>
        </tr>
        <tr>
          <td style="color:#6c757d;">Items:</td>
          <td style="font-weight:600;color:#212529;">${orderData.items_summary}</td>
        </tr>
        <tr>
          <td style="color:#6c757d;">Delivery Locality:</td>
          <td style="font-weight:600;color:#212529;">${orderData.customer_locality}</td>
        </tr>
        <tr style="border-top:1px solid #dee2e6;">
          <td style="color:#1b4332;font-weight:600;">Total Payable:</td>
          <td style="font-weight:700;color:#1b4332;font-size:16px;">${curr}${orderData.total_amount} (Cash/UPI on Delivery)</td>
        </tr>
      </table>

      <div style="text-align:center;margin-bottom:16px;">
        <a href="https://www.gariarice.in/#/order/${orderData.order_id}" style="display:inline-block;background-color:#1b4332;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">Track Live Order Status</a>
      </div>`;

    const html = this.buildBaseHtmlLayout_('Order Placed Successfully', body);
    return this.sendSafeEmail_(customerEmail, subject, html);
  }

  /**
   * Customer Notification: Order status milestone change.
   * @param {string} customerEmail - Customer's email.
   * @param {string} status - Destination status.
   * @param {Object} orderData - Order tokens.
   * @return {boolean} Success status.
   */
  static sendCustomerStatusUpdateEmail(customerEmail, status, orderData) {
    let headline = 'Order Update';
    let messageText = 'Your order status has been updated.';

    switch (status) {
      case CONFIG.ORDER_STATUS.SELLER_CONFIRMED:
        headline = 'Seller Confirmed Your Order';
        messageText = `${orderData.seller_name} has accepted your order and is currently preparing your rice bags.`;
        break;

      case CONFIG.ORDER_STATUS.READY_FOR_PICKUP:
        headline = 'Packed & Ready for Pickup';
        messageText = `Your rice bags are packed. A nearby delivery rider has been assigned to pick up your order.`;
        break;

      case CONFIG.ORDER_STATUS.OUT_FOR_DELIVERY:
        headline = 'Out for Delivery!';
        messageText = `A delivery partner has picked up your rice bags and is en route to your address. Please keep payment ready.`;
        break;

      case CONFIG.ORDER_STATUS.DELIVERED:
        headline = 'Delivered Successfully!';
        messageText = `Your rice has been safely delivered to your doorstep. Thank you for supporting local Garia businesses!`;
        break;

      case CONFIG.ORDER_STATUS.CANCELLED_BY_SELLER:
      case CONFIG.ORDER_STATUS.SELLER_REJECTED:
        headline = 'Order Update: Cancelled by Seller';
        messageText = `Unfortunately, ${orderData.seller_name} could not fulfill this order (item out of stock or shop closed). You can choose another nearby seller with one click.`;
        break;
    }

    const subject = `${headline}: Order ${orderData.order_id}`;
    const body = `
      <div style="background-color:#e8f5e9;border-left:4px solid #2d6a4f;padding:14px 16px;border-radius:4px;margin-bottom:20px;">
        <h2 style="margin:0 0 4px 0;color:#1b4332;font-size:18px;">${headline}</h2>
        <p style="margin:0;color:#2d6a4f;font-size:14px;">Order ID: <strong>${orderData.order_id}</strong></p>
      </div>

      <p style="font-size:15px;margin-bottom:16px;">Hello <strong>${orderData.customer_name}</strong>,</p>
      <p style="font-size:14px;color:#495057;line-height:1.6;margin-bottom:20px;">${messageText}</p>

      <div style="text-align:center;margin-bottom:12px;">
        <a href="https://www.gariarice.in/#/order/${orderData.order_id}" style="display:inline-block;background-color:#1b4332;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:6px;">View Order Timeline</a>
      </div>`;

    const html = this.buildBaseHtmlLayout_(headline, body);
    return this.sendSafeEmail_(customerEmail, subject, html);
  }

  /**
   * Post-Delivery: Customer review invitation with rating shortcut.
   * @param {string} customerEmail - Customer's email.
   * @param {Object} orderData - Order tokens.
   * @return {boolean} Success status.
   */
  static sendReviewRequestEmail(customerEmail, orderData) {
    const subject = `How was your rice from ${orderData.seller_name}? (Order ${orderData.order_id})`;

    const body = `
      <h2 style="color:#1b4332;font-size:18px;margin-top:0;">Rate Your Rice & Delivery Experience</h2>
      <p style="font-size:15px;margin-bottom:16px;">Hello <strong>${orderData.customer_name}</strong>,</p>
      <p style="font-size:14px;color:#495057;line-height:1.6;margin-bottom:20px;">
        Your order <strong>${orderData.order_id}</strong> from <strong>${orderData.seller_name}</strong> was delivered recently.
        Your verified review helps other local families in Garia choose the best quality rice and rewards dependable local merchants.
      </p>

      <div style="text-align:center;margin:28px 0;">
        <a href="https://www.gariarice.in/#/order/${orderData.order_id}?review=true" style="display:inline-block;background-color:#2d6a4f;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 32px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">⭐⭐⭐⭐⭐ Leave a 1-Minute Review</a>
      </div>`;

    const html = this.buildBaseHtmlLayout_('Leave a Review', body);
    return this.sendSafeEmail_(customerEmail, subject, html);
  }

  /**
   * Merchant: Account approval confirmation upon KYC review.
   * @param {string} sellerEmail - Merchant's email.
   * @param {Object} sellerData - Merchant tokens.
   * @return {boolean} Success status.
   */
  static sendSellerApprovalEmail(sellerEmail, sellerData) {
    const subject = `Congratulations! Your shop ${sellerData.seller_name} is now LIVE on Garia Rice Marketplace™`;

    const body = `
      <div style="background-color:#e8f5e9;border-left:4px solid #2d6a4f;padding:14px 16px;border-radius:4px;margin-bottom:20px;">
        <h2 style="margin:0 0 4px 0;color:#1b4332;font-size:18px;">Merchant Account Approved!</h2>
        <p style="margin:0;color:#2d6a4f;font-size:14px;">Shop Name: <strong>${sellerData.seller_name}</strong></p>
      </div>

      <p style="font-size:15px;margin-bottom:16px;">Hello <strong>${sellerData.owner_name}</strong>,</p>
      <p style="font-size:14px;color:#495057;line-height:1.6;margin-bottom:16px;">
        We are pleased to inform you that your merchant registration for <strong>${sellerData.seller_name}</strong> in ${sellerData.locality} has been verified and activated.
      </p>

      <h3 style="color:#1b4332;font-size:15px;margin-bottom:8px;">Next Steps:</h3>
      <ol style="font-size:14px;color:#495057;line-height:1.6;margin-bottom:24px;padding-left:20px;">
        <li>Log in to your Seller Portal using your registered mobile number.</li>
        <li>Review your rice varieties, pack sizes, and prices.</li>
        <li>Receive incoming order notifications directly via Email and WhatsApp.</li>
      </ol>

      <div style="text-align:center;margin-bottom:12px;">
        <a href="https://www.gariarice.in/#/seller/dashboard" style="display:inline-block;background-color:#1b4332;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:6px;">Go to Seller Dashboard</a>
      </div>`;

    const html = this.buildBaseHtmlLayout_('Merchant Account Approved', body);
    return this.sendSafeEmail_(sellerEmail, subject, html);
  }
}
