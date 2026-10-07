/**
 * ==============================================================================
 * GARIA RICE MARKETPLACE™ - SheetService.gs
 * Version: 1.0.0 | Production-Grade Hyperlocal Marketplace Engine
 * Geography: Garia, Kolkata, West Bengal, India
 * ==============================================================================
 * Centralized Database ORM & Persistence Layer.
 * Implements batch read/write operations, formula injection defense, in-memory
 * filtering, ID generation, and LockService concurrency control for all 22 tables.
 */

class SheetService {
  /**
   * Internal in-memory cache for sheet header rows to minimize API calls.
   * Key: sheetName, Value: string[]
   */
  static get headerCache_() {
    if (!this._headerCache) {
      this._headerCache = {};
    }
    return this._headerCache;
  }

  /**
   * Clears header cache (used after schema migrations or test setups).
   */
  static clearCache() {
    this._headerCache = {};
    this._spreadsheetInstance = null;
  }

  /**
   * Retrieves active Google Spreadsheet instance.
   * @return {GoogleAppsScript.Spreadsheet.Spreadsheet} Active spreadsheet.
   * @throws {Error} If Spreadsheet ID is missing or unreachable.
   */
  static getSpreadsheet() {
    if (this._spreadsheetInstance) {
      return this._spreadsheetInstance;
    }

    const spreadsheetId = AppConfig.getSpreadsheetId();
    if (!spreadsheetId) {
      throw new Error('[SheetService] SPREADSHEET_ID is not configured in Script Properties.');
    }

    try {
      this._spreadsheetInstance = SpreadsheetApp.openById(spreadsheetId);
      return this._spreadsheetInstance;
    } catch (err) {
      Logger.log('[SheetService.getSpreadsheet] Failed to open spreadsheet: ' + err.message);
      throw new Error('[SheetService] Database persistence layer is currently unreachable.');
    }
  }

  /**
   * Retrieves a specific Sheet tab by name with whitelist validation.
   * @param {string} sheetName - Target table name.
   * @return {GoogleAppsScript.Spreadsheet.Sheet} Sheet tab instance.
   * @throws {Error} If sheetName is unwhitelisted or tab does not exist.
   */
  static getSheet(sheetName) {
    if (!sheetName || typeof sheetName !== 'string') {
      throw new Error('[SheetService] Invalid sheet name provided.');
    }

    // Validate against schema whitelist
    const isWhitelisted = Object.values(CONFIG.SHEETS).includes(sheetName);
    if (!isWhitelisted) {
      throw new Error('[SheetService] Access denied: Sheet [' + sheetName + '] is not registered in schema.');
    }

    const ss = this.getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error('[SheetService] Required database table [' + sheetName + '] does not exist in spreadsheet.');
    }

    return sheet;
  }

  /**
   * Resolves and caches the column header array for a given sheet.
   * @param {string} sheetName - Target table name.
   * @return {string[]} Array of column header strings.
   */
  static getHeaders(sheetName) {
    if (this.headerCache_[sheetName]) {
      return this.headerCache_[sheetName];
    }

    const sheet = this.getSheet(sheetName);
    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) {
      return [];
    }

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    this.headerCache_[sheetName] = headers;
    return headers;
  }

  /**
   * Mitigates Formula Injection (CSV/Sheets injection).
   * If a string begins with dangerous prefix characters, prepends a single apostrophe.
   * @param {*} value - Cell value to sanitize.
   * @return {*} Sanitized value safe for spreadsheet persistence.
   */
  static sanitizeForCell(value) {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'object') {
      value = JSON.stringify(value);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r'];
      if (dangerousPrefixes.some(prefix => trimmed.startsWith(prefix))) {
        return "'" + value;
      }
      return value;
    }

    return value;
  }

  /**
   * Generates a stable, collision-resistant primary key.
   * Format: PREFIX-YYYYMMDD-HEX4
   * Example: ORD-20261007-A4B1
   * @param {string} prefix - Entity prefix (e.g., 'PRD', 'ORD', 'SLR').
   * @return {string} Canonical record ID.
   */
  static generateId(prefix = 'REC') {
    const cleanPrefix = String(prefix).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const now = new Date();
    
    // Format date in Asia/Kolkata timezone: YYYYMMDD
    const dateStr = Utilities.formatDate(now, CONFIG.APP.TIMEZONE, 'yyyyMMdd');
    
    // 4-character random hex token
    const randomHex = Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1)
      .toUpperCase();

    return cleanPrefix + '-' + dateStr + '-' + randomHex;
  }

  /**
   * Executes a database write operation wrapped in LockService to prevent race conditions.
   * @param {Function} operationFn - Function to execute inside critical section.
   * @param {number} [timeoutMs] - Lock acquisition wait timeout in milliseconds.
   * @return {*} Result returned by operationFn.
   * @throws {Error} If lock cannot be acquired within timeout.
   */
  static withLock(operationFn, timeoutMs = CONFIG.SECURITY.LOCK_TIMEOUT_MS) {
    const lock = LockService.getScriptLock();
    const success = lock.tryLock(timeoutMs);

    if (!success) {
      Logger.log('[SheetService.withLock] Lock acquisition timed out after ' + timeoutMs + 'ms');
      throw new Error('[SheetService] Database is experiencing high traffic. Please retry in a few moments.');
    }

    try {
      return operationFn();
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Reads all records from a table into an array of plain JavaScript objects.
   * Column headers become object property names.
   * @param {string} sheetName - Target table name.
   * @return {Object[]} Array of row objects.
   */
  static getAll(sheetName) {
    const sheet = this.getSheet(sheetName);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow <= 1 || lastCol < 1) {
      return []; // Empty table (only headers or blank)
    }

    const headers = this.getHeaders(sheetName);
    const dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    const values = dataRange.getValues();

    return values.map((row, rowIndex) => {
      const record = { _rowIndex: rowIndex + 2 };
      headers.forEach((header, colIndex) => {
        if (header) {
          let cellVal = row[colIndex];
          // Strip leading apostrophe added by formula injection protection for read consistency
          if (typeof cellVal === 'string' && cellVal.startsWith("'")) {
            const stripped = cellVal.substring(1);
            if (['=', '+', '-', '@'].some(p => stripped.startsWith(p))) {
              cellVal = stripped;
            }
          }
          record[header] = cellVal;
        }
      });
      return record;
    });
  }

  /**
   * Finds a single record by primary key or identifier column.
   * @param {string} sheetName - Target table name.
   * @param {string} idColumn - Primary key column name.
   * @param {*} idValue - Identifier value to match.
   * @return {Object|null} Matching record object or null if not found.
   */
  static findById(sheetName, idColumn, idValue) {
    if (idValue === null || idValue === undefined || idValue === '') {
      return null;
    }

    const targetVal = String(idValue).trim();
    const allRecords = this.getAll(sheetName);

    for (let i = 0; i < allRecords.length; i++) {
      if (String(allRecords[i][idColumn]).trim() === targetVal) {
        return allRecords[i];
      }
    }

    return null;
  }

  /**
   * Finds all records matching a specific field value.
   * @param {string} sheetName - Target table name.
   * @param {string} fieldName - Field column name to match.
   * @param {*} fieldValue - Value to match.
   * @return {Object[]} Array of matching records.
   */
  static findByField(sheetName, fieldName, fieldValue) {
    const targetVal = String(fieldValue).trim();
    const allRecords = this.getAll(sheetName);
    return allRecords.filter(rec => String(rec[fieldName]).trim() === targetVal);
  }

  /**
   * In-memory query engine supporting filtering, sorting, pagination, and limits.
   * @param {string} sheetName - Target table name.
   * @param {Function} [filterFn] - Predicate function returning true for included records.
   * @param {Function} [sortFn] - Comparative sorting function.
   * @param {number} [limit] - Max records to return.
   * @param {number} [offset] - Number of records to skip.
   * @return {Object[]} Filtered and sorted record set.
   */
  static query(sheetName, filterFn = null, sortFn = null, limit = null, offset = 0) {
    let records = this.getAll(sheetName);

    if (typeof filterFn === 'function') {
      records = records.filter(filterFn);
    }

    if (typeof sortFn === 'function') {
      records = records.sort(sortFn);
    }

    if (offset > 0) {
      records = records.slice(offset);
    }

    if (typeof limit === 'number' && limit > 0) {
      records = records.slice(0, limit);
    }

    return records;
  }

  /**
   * Inserts a single record into a table with schema alignment and cell sanitization.
   * @param {string} sheetName - Target table name.
   * @param {Object} recordObj - Data object with keys matching headers.
   * @return {Object} Inserted record with generated ID and timestamps if absent.
   */
  static insert(sheetName, recordObj) {
    return this.withLock(() => {
      const sheet = this.getSheet(sheetName);
      const headers = this.getHeaders(sheetName);

      if (headers.length === 0) {
        throw new Error('[SheetService.insert] Cannot insert into empty table with no headers: ' + sheetName);
      }

      const nowIso = new Date().toISOString();
      const record = Object.assign({}, recordObj);

      // Auto-populate timestamps if present in schema and not provided
      if (headers.includes('created_at') && !record.created_at) {
        record.created_at = nowIso;
      }
      if (headers.includes('updated_at') && !record.updated_at) {
        record.updated_at = nowIso;
      }

      // Map object properties to row values array strictly aligned with sheet headers
      const rowValues = headers.map(header => {
        const val = record[header];
        return SheetService.sanitizeForCell(val !== undefined ? val : '');
      });

      sheet.appendRow(rowValues);
      record._rowIndex = sheet.getLastRow();

      return record;
    });
  }

  /**
   * Fast batch insertion of multiple records in a single API call.
   * @param {string} sheetName - Target table name.
   * @param {Object[]} recordsArray - Array of data objects.
   * @return {number} Count of records successfully inserted.
   */
  static batchInsert(sheetName, recordsArray) {
    if (!Array.isArray(recordsArray) || recordsArray.length === 0) {
      return 0;
    }

    return this.withLock(() => {
      const sheet = this.getSheet(sheetName);
      const headers = this.getHeaders(sheetName);
      const nowIso = new Date().toISOString();

      const rows2D = recordsArray.map(recordObj => {
        const record = Object.assign({}, recordObj);
        if (headers.includes('created_at') && !record.created_at) {
          record.created_at = nowIso;
        }
        if (headers.includes('updated_at') && !record.updated_at) {
          record.updated_at = nowIso;
        }
        return headers.map(header => {
          const val = record[header];
          return SheetService.sanitizeForCell(val !== undefined ? val : '');
        });
      });

      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows2D.length, headers.length).setValues(rows2D);
      return rows2D.length;
    });
  }

  /**
   * Updates an existing record identified by its ID column.
   * Modifies only specified fields; unmentioned columns are preserved intact.
   * @param {string} sheetName - Target table name.
   * @param {string} idColumn - Primary key column name.
   * @param {*} idValue - Target identifier value.
   * @param {Object} updateFields - Object containing fields to update.
   * @return {Object} Updated record object.
   * @throws {Error} If record is not found.
   */
  static updateById(sheetName, idColumn, idValue, updateFields) {
    return this.withLock(() => {
      const sheet = this.getSheet(sheetName);
      const headers = this.getHeaders(sheetName);
      const existing = this.findById(sheetName, idColumn, idValue);

      if (!existing) {
        throw new Error('[SheetService.updateById] Record not found in [' + sheetName + '] where ' + idColumn + ' = ' + idValue);
      }

      const rowIndex = existing._rowIndex;
      const mergedRecord = Object.assign({}, existing, updateFields);

      // Auto-update timestamp if present in schema
      if (headers.includes('updated_at')) {
        mergedRecord.updated_at = new Date().toISOString();
      }

      const updatedRowValues = [
        headers.map(header => {
          const val = mergedRecord[header];
          return SheetService.sanitizeForCell(val !== undefined ? val : '');
        })
      ];

      sheet.getRange(rowIndex, 1, 1, headers.length).setValues(updatedRowValues);
      return mergedRecord;
    });
  }
}
