/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - Router.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Server-side view assembler and templating router.
 * Evaluates master layout shell (index.html) and provides safe, modular
 * inclusion of styles, client scripts, components, and views.
 */

/**
 * Top-level template helper required by Google Apps Script HTML scriptlets:
 * <?!= include('filename') ?>
 * @param {string} filename - Name of the HTML file (without .html extension).
 * @return {string} Raw evaluated HTML content.
 */
function include(filename) {
  return Router.include(filename);
}

/**
 * Server-side Router Class
 */
class Router {
  /**
   * Recognized and whitelisted route identifiers
   */
  static get VALID_ROUTES() {
    return [
      'home',
      'search',
      'catalog',
      'products',
      'product',
      'compare',
      'sellers',
      'seller',
      'cart',
      'checkout',
      'order',
      'account',
      'seller-portal',
      'rider-portal',
      'admin',
      'about',
      'contact',
      'faq',
      'privacy',
      'terms',
      'delivery-policy',
      'refund-policy',
      'seller-policy',
      'how-it-works'
    ];
  }

  /**
   * Sanitizes requested route to prevent directory traversal or script injection.
   * @param {string} rawPage - Unsanitized route from query parameter.
   * @return {string} Whitelisted route name.
   */
  static sanitizeRoute(rawPage) {
    if (!rawPage || typeof rawPage !== 'string') {
      return 'home';
    }
    // Remove any path traversal characters and keep only alphanumeric and hyphens
    const clean = rawPage.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return Router.VALID_ROUTES.includes(clean) ? clean : 'home';
  }

  /**
   * Evaluates and compiles the master HTML shell with route parameters.
   * @param {string} rawPage - Requested page name.
   * @param {Object} params - URL query parameters.
   * @return {HtmlOutput} Compiled HTML ready for browser delivery.
   */
  static renderView(rawPage, params = {}) {
    const activeRoute = Router.sanitizeRoute(rawPage);

    try {
      // Create template from master shell index.html
      const template = HtmlService.createTemplateFromFile('index');

      // Inject server-side state into the template context
      template.activeRoute = activeRoute;
      template.routeParams = params;
      template.appName = CONFIG.APP.NAME;
      template.appTagline = CONFIG.APP.TAGLINE;
      template.currencySymbol = CONFIG.APP.CURRENCY_SYMBOL;
      template.supportEmail = CONFIG.APP.SUPPORT_EMAIL;
      template.supportPhone = CONFIG.APP.SUPPORT_PHONE;

      // Evaluate the template and generate final HTML output
      return template.evaluate();

    } catch (err) {
      Logger.log('[Router.renderView] Error evaluating index.html: ' + err.message);

      // Resilient fallback shell in case index.html is not yet saved or contains syntax errors
      const fallbackHtml = 
        '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<title>' + CONFIG.APP.NAME + '</title>' +
        '<style>' +
        'body{font-family:system-ui,-apple-system,sans-serif;background:#f8f9fa;color:#212529;margin:0;padding:20px;}' +
        '.card{max-width:600px;margin:40px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 12px rgba(0,0,0,0.08);border-top:6px solid #1b4332;}' +
        'h1{color:#1b4332;margin-top:0;font-size:24px;}' +
        'p{line-height:1.6;color:#495057;}' +
        '.badge{display:inline-block;background:#e8f5e9;color:#1b4332;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;}' +
        '</style></head><body>' +
        '<div class="card">' +
        '<div class="badge">SYSTEM INITIALIZATION</div>' +
        '<h1>' + CONFIG.APP.NAME + '</h1>' +
        '<p><strong>Route:</strong> ' + activeRoute + '</p>' +
        '<p>' + CONFIG.APP.TAGLINE + '</p>' +
        '<hr style="border:none;border-top:1px solid #dee2e6;margin:20px 0;">' +
        '<p>The master interface template (<code>index.html</code>) is compiling or pending deployment.</p>' +
        '<p><small>Backend Services Status: <strong>ONLINE (Asia/Kolkata)</strong></small></p>' +
        '</div></body></html>';

      return HtmlService.createHtmlOutput(fallbackHtml);
    }
  }

  /**
   * Safely loads and evaluates a partial HTML file.
   * If the requested sub-template does not exist, returns a silent HTML comment
   * or developer placeholder instead of terminating execution.
   * @param {string} filename - Partial template file name (without .html extension).
   * @return {string} Evaluated HTML string.
   */
  static include(filename) {
    if (!filename || typeof filename !== 'string') {
      return '<!-- [Router.include] Invalid filename supplied -->';
    }

    // Clean filename to allow only alphanumeric, underscores, and forward slashes
    const cleanFilename = filename.trim().replace(/[^a-zA-Z0-9_\-\/]/g, '');

    try {
      return HtmlService.createHtmlOutputFromFile(cleanFilename).getContent();
    } catch (err) {
      Logger.log('[Router.include] Notice: Template partial [' + cleanFilename + '] not loaded: ' + err.message);
      // Non-breaking fallback: returns safe HTML comment during progressive file construction
      return '<!-- Partial [' + cleanFilename + '] pending creation -->';
    }
  }
}
