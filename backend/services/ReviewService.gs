/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - ReviewService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Master Verified Customer Reviews, Moderation Queue, and Social Staging Engine.
 * Enforces verified purchase linkages, 3-tier star ratings, merchant aggregate
 * recalculation, and automated formatting of share-ready Facebook promotional copy.
 */

class ReviewService {
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
        case 'submitOrderReview':
          return this.submitReview(payload, authToken);

        case 'getApprovedReviews':
          return this.getApprovedReviews(payload.product_id, payload.seller_id, payload.limit);

        case 'getPendingReviews':
          return this.getPendingReviews(authToken);

        case 'moderateReview':
          return this.moderateReview(payload.review_id, payload.new_status, authToken);

        default:
          return ErrorService.createClientError(
            'Unrecognized review action: ' + action,
            ErrorService.CODES.INVALID_PARAMETERS
          );
      }
    } catch (err) {
      return ErrorService.handleException(err, 'ReviewService.dispatch.' + action);
    }
  }

  /**
   * Submits a verified customer review linked to a completed order.
   * @param {Object} payload - { order_id, overall_rating, rice_quality_rating, delivery_rating, review_text }
   * @param {string} authToken - Customer session token.
   * @return {Object} API response envelope with created review.
   */
  static submitReview(payload, authToken) {
    const auth = SecurityService.authorizeRequest(authToken, [CONFIG.ROLES.CUSTOMER, CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError(auth.error, auth.code);
    }

    const orderId = payload.order_id;
    if (!orderId) {
      return ErrorService.createClientError('Order ID is required to submit a verified review.', ErrorService.CODES.INVALID_PARAMETERS);
    }

    // 1. Verify that the order exists
    const order = SheetService.findById(CONFIG.SHEETS.ORDERS, 'order_id', orderId);
    if (!order) {
      return ErrorService.createClientError('Order not found.', ErrorService.CODES.ORDER_NOT_FOUND);
    }

    // 2. IDOR Check: Ensure calling customer placed this order
    const customers = SheetService.findByField(CONFIG.SHEETS.CUSTOMERS, 'user_id', auth.user.user_id);
    const customerId = (customers && customers.length > 0) ? customers[0].customer_id : null;

    if (!customerId || order.customer_id !== customerId) {
      return ErrorService.createClientError('Access denied: You can only review orders you personally placed.', ErrorService.CODES.UNAUTHORIZED);
    }

    // 3. Verified Delivery Check: Order must be delivered
    const eligibleStatuses = [
      CONFIG.ORDER_STATUS.DELIVERED,
      CONFIG.ORDER_STATUS.CUSTOMER_CONFIRMED,
      CONFIG.ORDER_STATUS.REVIEW_REQUESTED,
      CONFIG.ORDER_STATUS.COMPLETED
    ];

    if (!eligibleStatuses.includes(order.current_status)) {
      return ErrorService.createClientError(
        'Reviews can only be submitted after your rice delivery is completed (Current status: ' + order.current_status + ').',
        ErrorService.CODES.ORDER_INVALID_STATE
      );
    }

    // 4. Duplicate Check: Exactly 1 review per order
    const existingReviews = SheetService.findByField(CONFIG.SHEETS.REVIEWS, 'order_id', orderId);
    if (existingReviews && existingReviews.length > 0) {
      return ErrorService.createClientError(
        'A verified review has already been submitted for this order.',
        ErrorService.CODES.DUPLICATE_ENTRY
      );
    }

    // 5. Validate Star Ratings (1 to 5 integer bounds)
    const overallRating = Math.round(SecurityService.sanitizeNumber(payload.overall_rating, 1, 5, 5));
    const riceRating = Math.round(SecurityService.sanitizeNumber(payload.rice_quality_rating, 1, 5, overallRating));
    const deliveryRating = Math.round(SecurityService.sanitizeNumber(payload.delivery_rating, 1, 5, overallRating));
    const comment = SecurityService.sanitizeText(payload.review_text, 600);

    // Resolve primary product ID from ORDER_ITEMS
    const items = SheetService.findByField(CONFIG.SHEETS.ORDER_ITEMS, 'order_id', orderId);
    const primaryProductId = (items && items.length > 0) ? items[0].product_id : '';

    const nowIso = new Date().toISOString();
    const newReview = {
      review_id: SheetService.generateId('REV'),
      order_id: orderId,
      customer_id: customerId,
      seller_id: order.seller_id,
      product_id: primaryProductId,
      overall_rating: overallRating,
      rice_quality_rating: riceRating,
      delivery_rating: deliveryRating,
      review_text: comment,
      moderation_status: CONFIG.APPROVAL_STATUS.PENDING_REVIEW,
      fb_draft_created: false,
      created_at: nowIso,
      moderated_at: ''
    };

    SheetService.insert(CONFIG.SHEETS.REVIEWS, newReview);

    // Transition order to COMPLETED if currently in REVIEW_REQUESTED or DELIVERED
    try {
      if (order.current_status !== CONFIG.ORDER_STATUS.COMPLETED) {
        SheetService.updateById(CONFIG.SHEETS.ORDERS, 'order_id', orderId, {
          current_status: CONFIG.ORDER_STATUS.COMPLETED,
          updated_at: nowIso
        });
      }
    } catch (e) {
      Logger.log('[ReviewService.submitReview] Notice: Order status transition skipped: ' + e.message);
    }

    return {
      success: true,
      data: {
        review_id: newReview.review_id,
        moderation_status: newReview.moderation_status,
        message: 'Thank you for your review! It has been submitted and will appear publicly following brief quality moderation.'
      },
      error: null,
      code: null,
      timestamp: nowIso
    };
  }

  /**
   * Admin: Moderates a submitted review (APPROVED / REJECTED).
   * Upon approval, automatically recalculates merchant ratings and stages Facebook post.
   * @param {string} reviewId - Target Review ID.
   * @param {string} newStatus - 'APPROVED' or 'REJECTED'.
   * @param {string} adminAuthToken - Admin session token.
   * @return {Object} API response envelope.
   */
  static moderateReview(reviewId, newStatus, adminAuthToken) {
    const auth = SecurityService.authorizeRequest(adminAuthToken, [CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError('Admin authorization required.', ErrorService.CODES.UNAUTHORIZED);
    }

    const review = SheetService.findById(CONFIG.SHEETS.REVIEWS, 'review_id', reviewId);
    if (!review) {
      return ErrorService.createClientError('Review not found.', ErrorService.CODES.NOT_FOUND);
    }

    const validStatuses = [CONFIG.APPROVAL_STATUS.APPROVED, CONFIG.APPROVAL_STATUS.REJECTED];
    const statusUpper = String(newStatus).toUpperCase();
    if (!validStatuses.includes(statusUpper)) {
      return ErrorService.createClientError('Invalid moderation status. Must be APPROVED or REJECTED.', ErrorService.CODES.INVALID_PARAMETERS);
    }

    const nowIso = new Date().toISOString();
    const oldStatus = review.moderation_status;

    // 1. Update review record
    const updatedReview = SheetService.updateById(CONFIG.SHEETS.REVIEWS, 'review_id', reviewId, {
      moderation_status: statusUpper,
      moderated_at: nowIso
    });

    AuditService.logApprovalShift('REVIEWS', reviewId, auth.user.user_id, oldStatus, statusUpper, 'Admin review moderation');

    // 2. If APPROVED: Recalculate merchant ratings and stage Facebook post draft
    if (statusUpper === CONFIG.APPROVAL_STATUS.APPROVED) {
      this.recalculateSellerRating_(review.seller_id);
      this.stageFacebookReviewDraft_(updatedReview);
    }

    return {
      success: true,
      data: {
        review_id: reviewId,
        moderation_status: statusUpper,
        message: 'Review ' + reviewId + ' successfully marked as ' + statusUpper
      },
      error: null,
      code: null,
      timestamp: nowIso
    };
  }

  /**
   * Internal helper: Recalculates merchant average rating and review count.
   * Updates rating_avg and review_count in the SELLERS table.
   * @private
   */
  static recalculateSellerRating_(sellerId) {
    try {
      if (!sellerId) return;

      const sellerReviews = SheetService.findByField(CONFIG.SHEETS.REVIEWS, 'seller_id', sellerId);
      const approvedReviews = sellerReviews.filter(r => r.moderation_status === CONFIG.APPROVAL_STATUS.APPROVED);

      if (approvedReviews.length === 0) return;

      const totalStars = approvedReviews.reduce((sum, r) => sum + (parseFloat(r.overall_rating) || 5), 0);
      const avgRating = Math.round((totalStars / approvedReviews.length) * 10) / 10;

      SheetService.updateById(CONFIG.SHEETS.SELLERS, 'seller_id', sellerId, {
        rating_avg: avgRating,
        review_count: approvedReviews.length,
        updated_at: new Date().toISOString()
      });

    } catch (err) {
      Logger.log('[ReviewService.recalculateSellerRating_] Error: ' + err.message);
    }
  }

  /**
   * Internal helper: Stages a ready-to-copy Facebook promotional post draft.
   * Conforms strictly to Section 40. Persists to FACEBOOK_DRAFTS sheet.
   * @private
   */
  static stageFacebookReviewDraft_(review) {
    try {
      if (review.fb_draft_created) return;

      // Resolve product name and seller name
      const product = SheetService.findById(CONFIG.SHEETS.PRODUCTS, 'product_id', review.product_id);
      const seller = SheetService.findById(CONFIG.SHEETS.SELLERS, 'seller_id', review.seller_id);

      const productName = product ? product.name_en : 'Premium Local Rice';
      const sellerName = seller ? seller.business_name : 'Garia Rice Merchant';
      const locality = seller ? seller.locality : 'Garia, Kolkata';

      const stars = '⭐'.repeat(Math.min(5, Math.max(1, parseInt(review.overall_rating, 10) || 5)));
      const headline = stars + ' Customer Review — Garia Rice Marketplace';

      const postBody =
        headline + '\n\n' +
        '"' + (review.review_text || 'Excellent quality rice delivered promptly!') + '"\n\n' +
        '🌾 Rice: ' + productName + '\n' +
        '🏪 Seller: ' + sellerName + ' (' + locality + ')\n' +
        '🚚 Delivered at home in Garia\n\n' +
        'Thank you for trusting local sellers on Garia Rice Marketplace™.\n' +
        'Compare prices & order fresh rice: https://www.gariarice.in';

      const draftRecord = {
        draft_id: SheetService.generateId('FBD'),
        review_id: review.review_id,
        post_headline: headline,
        post_body: postBody,
        hashtags: '#GariaRice #KolkataRice #LocalMarketplace #MiniketRice #GariaLocal',
        status: 'DRAFT_STAGED',
        created_at: new Date().toISOString()
      };

      SheetService.insert(CONFIG.SHEETS.FACEBOOK_DRAFTS, draftRecord);

      // Mark review as drafted
      SheetService.updateById(CONFIG.SHEETS.REVIEWS, 'review_id', review.review_id, {
        fb_draft_created: true
      });

    } catch (err) {
      Logger.log('[ReviewService.stageFacebookReviewDraft_] Error staging draft: ' + err.message);
    }
  }

  /**
   * Public: Retrieves approved customer reviews for a product or seller.
   * @param {string} [productId=null] - Optional filter by product.
   * @param {string} [sellerId=null] - Optional filter by merchant.
   * @param {number} [limit=10] - Max reviews to return.
   * @return {Object} API response envelope with approved reviews.
   */
  static getApprovedReviews(productId = null, sellerId = null, limit = 10) {
    const allReviews = SheetService.getAll(CONFIG.SHEETS.REVIEWS);

    let approved = allReviews.filter(r => {
      if (r.moderation_status !== CONFIG.APPROVAL_STATUS.APPROVED) return false;
      if (productId && r.product_id !== productId) return false;
      if (sellerId && r.seller_id !== sellerId) return false;
      return true;
    });

    // Sort newest first
    approved.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const resultList = approved.slice(0, limit).map(r => ({
      review_id: r.review_id,
      overall_rating: parseInt(r.overall_rating, 10) || 5,
      rice_quality_rating: parseInt(r.rice_quality_rating, 10) || 5,
      delivery_rating: parseInt(r.delivery_rating, 10) || 5,
      review_text: r.review_text || '',
      created_at: r.created_at
    }));

    return {
      success: true,
      data: {
        total_count: approved.length,
        reviews: resultList
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Admin: Retrieves reviews pending moderation.
   * @param {string} adminAuthToken - Admin session token.
   * @return {Object} API response envelope with pending reviews queue.
   */
  static getPendingReviews(adminAuthToken) {
    const auth = SecurityService.authorizeRequest(adminAuthToken, [CONFIG.ROLES.ADMIN]);
    if (!auth.authorized) {
      return ErrorService.createClientError('Admin authorization required.', ErrorService.CODES.UNAUTHORIZED);
    }

    const allReviews = SheetService.getAll(CONFIG.SHEETS.REVIEWS);
    const pending = allReviews.filter(
      r => r.moderation_status === CONFIG.APPROVAL_STATUS.PENDING_REVIEW || r.moderation_status === 'PENDING'
    );

    return {
      success: true,
      data: {
        pending_count: pending.length,
        reviews: pending
      },
      error: null,
      code: null,
      timestamp: new Date().toISOString()
    };
  }
}
