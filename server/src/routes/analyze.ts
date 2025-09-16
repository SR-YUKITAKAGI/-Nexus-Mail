import express from 'express';
import { UnifiedEmailAnalyzer } from '../services/unifiedEmailAnalyzer';
import { GmailService } from '../services/gmailService';
import { db } from '../services/database';
import { requireAuth } from '../middleware/auth';

const router = express.Router();
const analyzer = new UnifiedEmailAnalyzer();

// 最近のメールを取得して分析
router.get('/analyze-recent', requireAuth, async (req: any, res) => {
  try {
    const { after = '2025/08/01', limit = 20 } = req.query;

    console.log(`📧 Fetching emails after ${after}, limit: ${limit}`);

    // GmailAPIでメールを取得
    const gmailService = new GmailService(req.user.accessToken, req.user.refreshToken);
    const query = `after:${after}`;
    const messages = await gmailService.searchMessages(query, parseInt(limit as string));

    if (!messages || messages.length === 0) {
      return res.json({ emails: [], analysis: [] });
    }

    console.log(`📨 Found ${messages.length} emails to analyze`);

    // メールの詳細を取得して分析
    const emailAnalysis = [];
    const processedEmails = [];

    for (const message of messages) {
      try {
        // メール詳細を取得 (parseMessage済み)
        const email = await gmailService.getMessage(message.id);

        // メールの基本情報を抽出 (既にparseMessage済み)
        const subject = email.subject || '';
        const from = email.from || '';
        const date = email.date || '';
        const body = email.body || email.bodyHtml || '';

        // Claude APIで分析
        console.log(`🤖 Analyzing email: ${subject.substring(0, 50)}...`);
        const analysis = await analyzer.analyzeEmail(
          body,
          subject,
          from,
          email.id,
          email.to,
          undefined, // cc
          req.user.id || 'default'
        );

        // 分析結果にメール情報を追加
        const result = {
          emailId: email.id,
          subject,
          from,
          date,
          ...analysis
        };

        emailAnalysis.push(result);
        processedEmails.push({
          id: email.id,
          subject,
          from,
          date,
          snippet: email.snippet
        });

        // データベースに保存
        await saveAnalysisToDatabase(email.id, analysis);

      } catch (err) {
        console.error(`Failed to analyze email ${message.id}:`, err);
      }
    }

    console.log(`✅ Successfully analyzed ${emailAnalysis.length} emails`);

    res.json({
      emails: processedEmails,
      analysis: emailAnalysis
    });

  } catch (error: any) {
    console.error('Error analyzing emails:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze emails' });
  }
});

// 分析結果をデータベースに保存
async function saveAnalysisToDatabase(emailId: string, analysis: any) {
  try {
    // メール分析結果を保存
    await (db as any).query(`
      INSERT INTO email_analysis (email_id, analysis_data, analyzed_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (email_id)
      DO UPDATE SET
        analysis_data = $2,
        analyzed_at = NOW()
    `, [emailId, JSON.stringify(analysis)]);

    // 購入情報を保存
    if (analysis.purchase && analysis.purchase.isPurchase) {
      await (db as any).query(`
        INSERT INTO purchases (
          email_id, vendor, amount, currency, order_id,
          items, tracking_number, delivery_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (email_id) DO UPDATE SET
          vendor = $2, amount = $3, currency = $4
      `, [
        emailId,
        analysis.purchase.vendor,
        analysis.purchase.amount,
        analysis.purchase.currency,
        analysis.purchase.orderId,
        JSON.stringify(analysis.purchase.items),
        analysis.purchase.trackingNumber,
        analysis.purchase.deliveryDate
      ]);
    }

    // 連絡先情報を保存
    if (analysis.contacts && analysis.contacts.length > 0) {
      for (const contact of analysis.contacts) {
        await (db as any).query(`
          INSERT INTO contacts (
            email, name, company, phone, role, relationship
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (email) DO UPDATE SET
            name = COALESCE($2, contacts.name),
            company = COALESCE($3, contacts.company),
            phone = COALESCE($4, contacts.phone)
        `, [
          contact.email,
          contact.name,
          contact.company,
          contact.phone,
          contact.role,
          contact.relationship
        ]);
      }
    }

    // カレンダーイベントを保存
    if (analysis.event && analysis.event.isEvent) {
      await (db as any).query(`
        INSERT INTO calendar_events (
          email_id, title, event_date, event_time, location,
          event_type, meeting_link, attendees
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (email_id) DO UPDATE SET
          title = $2, event_date = $3, location = $5
      `, [
        emailId,
        analysis.event.title,
        analysis.event.date,
        analysis.event.time,
        analysis.event.location,
        analysis.event.type,
        analysis.event.meetingLink,
        JSON.stringify(analysis.event.attendees)
      ]);
    }

  } catch (err) {
    console.error('Failed to save analysis to database:', err);
  }
}

export default router;