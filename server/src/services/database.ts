import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'nexus_mail.db');

class Database {
  private db: sqlite3.Database;
  private run: (sql: string, params?: any[]) => Promise<void>;
  private get: (sql: string, params?: any[]) => Promise<any>;
  private all: (sql: string, params?: any[]) => Promise<any[]>;

  constructor() {
    this.db = new sqlite3.Database(dbPath);
    this.run = promisify(this.db.run.bind(this.db));
    this.get = promisify(this.db.get.bind(this.db));
    this.all = promisify(this.db.all.bind(this.db));

    this.initializeDatabase();
  }

  private async initializeDatabase() {
    try {
      // Create email_analysis table
      await this.run(`
        CREATE TABLE IF NOT EXISTS email_analysis (
          email_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          analysis_result TEXT NOT NULL,
          analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          email_date DATETIME,
          from_address TEXT,
          subject TEXT,
          was_filtered INTEGER DEFAULT 0,
          filter_reason TEXT
        )
      `);

      // Create purchases table
      await this.run(`
        CREATE TABLE IF NOT EXISTS purchases (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          email_id TEXT NOT NULL,
          order_id TEXT,
          vendor TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT,
          date DATETIME,
          items TEXT,
          status TEXT,
          tracking_number TEXT,
          category TEXT,
          payment_method TEXT,
          email_subject TEXT,
          email_from TEXT,
          email_type TEXT,
          related_email_ids TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, email_id)
        )
      `);

      // Create indexes
      await this.run(`
        CREATE INDEX IF NOT EXISTS idx_user_id ON email_analysis(user_id)
      `);

      await this.run(`
        CREATE INDEX IF NOT EXISTS idx_email_date ON email_analysis(email_date)
      `);

      // Create manual exclusions table
      await this.run(`
        CREATE TABLE IF NOT EXISTS manual_exclusions (
          email_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          excluded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reason TEXT
        )
      `);

      await this.run(`
        CREATE INDEX IF NOT EXISTS idx_user_exclusion ON manual_exclusions(user_id)
      `);

      // Create contacts table
      await this.run(`
        CREATE TABLE IF NOT EXISTS contacts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          email TEXT NOT NULL,
          name TEXT NOT NULL,
          first_name TEXT,
          last_name TEXT,
          company TEXT,
          position TEXT,
          phone TEXT,
          linkedin TEXT,
          twitter TEXT,
          website TEXT,
          notes TEXT,
          tags TEXT,
          email_frequency INTEGER DEFAULT 0,
          last_email_date DATETIME,
          first_email_date DATETIME,
          total_emails_sent INTEGER DEFAULT 0,
          total_emails_received INTEGER DEFAULT 0,
          relationship_score INTEGER DEFAULT 0,
          is_vip BOOLEAN DEFAULT FALSE,
          is_blocked BOOLEAN DEFAULT FALSE,
          avatar_url TEXT,
          source_email_ids TEXT,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, email)
        )
      `);

      // Create indexes for contacts
      await this.run(`
        CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id)
      `);

      await this.run(`
        CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)
      `);

      await this.run(`
        CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name)
      `);

      console.log('✅ Database initialized successfully');
    } catch (error) {
      console.error('Database initialization error:', error);
    }
  }

  async saveAnalysis(
    emailId: string,
    userId: string,
    analysisResult: any,
    emailDate?: Date,
    from?: string,
    subject?: string,
    wasFiltered: boolean = false,
    filterReason?: string
  ): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO email_analysis
      (email_id, user_id, analysis_result, email_date, from_address, subject, was_filtered, filter_reason, analyzed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    await this.run(sql, [
      emailId,
      userId,
      JSON.stringify(analysisResult),
      emailDate ? emailDate.toISOString() : null,
      from,
      subject,
      wasFiltered ? 1 : 0,
      filterReason
    ]);
  }

  async getAnalysis(emailId: string, userId: string): Promise<any | null> {
    const sql = `
      SELECT analysis_result, analyzed_at
      FROM email_analysis
      WHERE email_id = ? AND user_id = ?
    `;

    const row = await this.get(sql, [emailId, userId]);

    if (row) {
      // Check if analysis is older than 30 days
      const analyzedAt = new Date(row.analyzed_at);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      if (analyzedAt < thirtyDaysAgo) {
        // Analysis is too old, return null to trigger re-analysis
        return null;
      }

      return JSON.parse(row.analysis_result);
    }

    return null;
  }

  async getRecentAnalyses(userId: string, limit: number = 100): Promise<any[]> {
    const sql = `
      SELECT * FROM email_analysis
      WHERE user_id = ?
      ORDER BY analyzed_at DESC
      LIMIT ?
    `;

    const rows = await this.all(sql, [userId, limit]);

    return rows.map(row => ({
      emailId: row.email_id,
      analysis: JSON.parse(row.analysis_result),
      analyzedAt: row.analyzed_at,
      emailDate: row.email_date,
      from: row.from_address,
      subject: row.subject,
      wasFiltered: row.was_filtered === 1,
      filterReason: row.filter_reason
    }));
  }

  async getAnalysisStats(userId: string): Promise<any> {
    const sql = `
      SELECT
        COUNT(*) as total_analyzed,
        SUM(CASE WHEN was_filtered = 1 THEN 1 ELSE 0 END) as total_filtered,
        COUNT(DISTINCT DATE(analyzed_at)) as days_analyzed
      FROM email_analysis
      WHERE user_id = ?
    `;

    const stats = await this.get(sql, [userId]);

    // Calculate cost savings (approximate)
    const apiCallsSaved = stats.total_filtered || 0;
    const costPerCall = 0.003; // Approximate cost per Haiku API call
    const estimatedCostSaved = `$${(apiCallsSaved * costPerCall).toFixed(2)}`;

    return {
      totalAnalyzed: stats.total_analyzed || 0,
      totalFiltered: stats.total_filtered || 0,
      apiCallsSaved,
      estimatedCostSaved,
      daysAnalyzed: stats.days_analyzed || 0
    };
  }

  async cleanOldAnalyses(daysToKeep: number = 30): Promise<void> {
    const sql = `
      DELETE FROM email_analysis
      WHERE analyzed_at < datetime('now', '-' || ? || ' days')
    `;

    await this.run(sql, [daysToKeep]);
  }

  async markAsExcluded(emailId: string, userId: string, reason: string = 'manual'): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO manual_exclusions
      (email_id, user_id, reason, excluded_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;

    await this.run(sql, [emailId, userId, reason]);
  }

  async unmarkAsExcluded(emailId: string, userId: string): Promise<void> {
    const sql = `
      DELETE FROM manual_exclusions
      WHERE email_id = ? AND user_id = ?
    `;

    await this.run(sql, [emailId, userId]);
  }

  async getExclusions(userId: string): Promise<string[]> {
    const sql = `
      SELECT email_id FROM manual_exclusions
      WHERE user_id = ?
    `;

    const rows = await this.all(sql, [userId]);
    return rows.map(row => row.email_id);
  }

  async savePurchase(purchase: any, userId: string): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO purchases
      (id, user_id, email_id, order_id, vendor, amount, currency, date, items,
       status, tracking_number, category, payment_method, email_subject,
       email_from, email_type, related_email_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.run(sql, [
      purchase.id,
      userId,
      purchase.emailId,
      purchase.orderId || null,
      purchase.vendor,
      purchase.amount,
      purchase.currency || 'JPY',
      purchase.date,
      JSON.stringify(purchase.items || []),
      purchase.status || null,
      purchase.trackingNumber || null,
      purchase.category || null,
      purchase.paymentMethod || null,
      purchase.emailSubject || null,
      purchase.emailFrom || null,
      purchase.emailType || null,
      JSON.stringify(purchase.relatedEmailIds || [])
    ]);
  }

  async getPurchases(userId: string): Promise<any[]> {
    const sql = `
      SELECT * FROM purchases
      WHERE user_id = ?
      ORDER BY date DESC
    `;

    const rows = await this.all(sql, [userId]);
    return rows.map(row => ({
      ...row,
      emailId: row.email_id,  // Map email_id to emailId for consistency
      emailSubject: row.email_subject,  // Map email_subject
      emailFrom: row.email_from,  // Map email_from
      items: JSON.parse(row.items || '[]'),
      relatedEmailIds: JSON.parse(row.related_email_ids || '[]')
    }));
  }

  async deletePurchase(purchaseId: string, userId: string): Promise<void> {
    const sql = `
      DELETE FROM purchases
      WHERE id = ? AND user_id = ?
    `;

    await this.run(sql, [purchaseId, userId]);
  }

  async updatePurchase(purchaseId: string, userId: string, updates: any): Promise<void> {
    const existingPurchase = await this.get(
      'SELECT * FROM purchases WHERE id = ? AND user_id = ?',
      [purchaseId, userId]
    );

    if (!existingPurchase) return;

    const updatedPurchase = { ...existingPurchase, ...updates };
    await this.savePurchase(updatedPurchase, userId);
  }

  // Contact-related methods
  async saveContact(contact: any, userId: string): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO contacts
      (id, user_id, email, name, first_name, last_name, company, position,
       phone, linkedin, twitter, website, notes, tags, email_frequency,
       last_email_date, first_email_date, total_emails_sent, total_emails_received,
       relationship_score, is_vip, is_blocked, avatar_url, source_email_ids, metadata,
       updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    await this.run(sql, [
      contact.id || `${userId}_${contact.email}`,
      userId,
      contact.email,
      contact.name,
      contact.firstName || null,
      contact.lastName || null,
      contact.company || null,
      contact.position || null,
      contact.phone || null,
      contact.linkedin || null,
      contact.twitter || null,
      contact.website || null,
      contact.notes || null,
      JSON.stringify(contact.tags || []),
      contact.emailFrequency || 0,
      contact.lastEmailDate || null,
      contact.firstEmailDate || null,
      contact.totalEmailsSent || 0,
      contact.totalEmailsReceived || 0,
      contact.relationshipScore || 0,
      contact.isVip ? 1 : 0,
      contact.isBlocked ? 1 : 0,
      contact.avatarUrl || null,
      JSON.stringify(contact.sourceEmailIds || []),
      JSON.stringify(contact.metadata || {})
    ]);
  }

  async getContacts(userId: string, options: {
    limit?: number,
    offset?: number,
    search?: string,
    tags?: string[],
    isVip?: boolean
  } = {}): Promise<any[]> {
    let sql = `
      SELECT * FROM contacts
      WHERE user_id = ?
    `;
    const params: any[] = [userId];

    if (options.search) {
      sql += ` AND (name LIKE ? OR email LIKE ? OR company LIKE ?)`;
      const searchPattern = `%${options.search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    if (options.tags && options.tags.length > 0) {
      sql += ` AND (`;
      const tagConditions = options.tags.map(() => `tags LIKE ?`);
      sql += tagConditions.join(' OR ') + ')';
      options.tags.forEach(tag => params.push(`%"${tag}"%`));
    }

    if (options.isVip !== undefined) {
      sql += ` AND is_vip = ?`;
      params.push(options.isVip ? 1 : 0);
    }

    sql += ` ORDER BY relationship_score DESC, last_email_date DESC`;

    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);

      if (options.offset) {
        sql += ` OFFSET ?`;
        params.push(options.offset);
      }
    }

    const rows = await this.all(sql, params);
    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      sourceEmailIds: JSON.parse(row.source_email_ids || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      isVip: row.is_vip === 1,
      isBlocked: row.is_blocked === 1
    }));
  }

  async getContact(contactId: string, userId: string): Promise<any | null> {
    const sql = `
      SELECT * FROM contacts
      WHERE id = ? AND user_id = ?
    `;

    const row = await this.get(sql, [contactId, userId]);

    if (row) {
      return {
        ...row,
        tags: JSON.parse(row.tags || '[]'),
        sourceEmailIds: JSON.parse(row.source_email_ids || '[]'),
        metadata: JSON.parse(row.metadata || '{}'),
        isVip: row.is_vip === 1,
        isBlocked: row.is_blocked === 1
      };
    }

    return null;
  }

  async updateContact(contactId: string, userId: string, updates: any): Promise<void> {
    const existingContact = await this.getContact(contactId, userId);
    if (!existingContact) return;

    const updatedContact = { ...existingContact, ...updates };
    await this.saveContact(updatedContact, userId);
  }

  async deleteContact(contactId: string, userId: string): Promise<void> {
    const sql = `
      DELETE FROM contacts
      WHERE id = ? AND user_id = ?
    `;

    await this.run(sql, [contactId, userId]);
  }

  async getContactStats(userId: string): Promise<any> {
    const sql = `
      SELECT
        COUNT(*) as total_contacts,
        SUM(CASE WHEN is_vip = 1 THEN 1 ELSE 0 END) as vip_contacts,
        SUM(CASE WHEN company IS NOT NULL THEN 1 ELSE 0 END) as with_company,
        AVG(relationship_score) as avg_relationship_score
      FROM contacts
      WHERE user_id = ?
    `;

    return await this.get(sql, [userId]);
  }

  async updateContactEmailStats(email: string, userId: string, isSent: boolean): Promise<void> {
    const sql = `
      UPDATE contacts
      SET
        ${isSent ? 'total_emails_sent = total_emails_sent + 1' : 'total_emails_received = total_emails_received + 1'},
        last_email_date = CURRENT_TIMESTAMP,
        relationship_score = MIN(100, relationship_score + 1),
        updated_at = CURRENT_TIMESTAMP
      WHERE email = ? AND user_id = ?
    `;

    await this.run(sql, [email, userId]);
  }
}

export const db = new Database();