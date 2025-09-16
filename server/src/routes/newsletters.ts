import express from 'express';
import { requireAuth } from '../middleware/auth';
import { GmailService } from '../services/gmailService';
import { db } from '../services/database';

const router = express.Router();

// Get all newsletters
router.get('/threads', requireAuth, async (req: any, res) => {
  try {
    const { maxResults = 50, pageToken } = req.query;

    // Get newsletter emails from database (already analyzed)
    const newsletters = await (db as any).all(`
      SELECT
        ea.email_id,
        ea.subject,
        ea.from_address,
        ea.email_date,
        ea.analysis_result
      FROM email_analysis ea
      WHERE
        ea.user_id = ?
        AND ea.analysis_result LIKE '%"emailType":"newsletter"%'
      ORDER BY ea.email_date DESC
      LIMIT ?
    `, [req.user.id || 'default', parseInt(maxResults as string)]);

    // Parse and format the newsletters
    const formattedNewsletters = newsletters.map((newsletter: any) => {
      let analysis;
      try {
        analysis = JSON.parse(newsletter.analysis_result);
      } catch {
        analysis = {};
      }

      return {
        id: newsletter.email_id,
        subject: newsletter.subject,
        from: newsletter.from_address,
        date: newsletter.email_date,
        snippet: analysis.discovery?.keyTopics?.join(', ') || '',
        category: analysis.category || 'Newsletter',
        priority: analysis.priority || 'low',
        sentiment: analysis.discovery?.sentiment || 'neutral',
        unsubscribeLink: extractUnsubscribeLink(newsletter.analysis_result)
      };
    });

    // Get total count
    const countResult = await (db as any).get(`
      SELECT COUNT(*) as total
      FROM email_analysis
      WHERE
        user_id = ?
        AND analysis_result LIKE '%"emailType":"newsletter"%'
    `, [req.user.id || 'default']);

    res.json({
      newsletters: formattedNewsletters,
      totalCount: countResult.total,
      nextPageToken: null // SQLite doesn't have native pagination tokens
    });

  } catch (error: any) {
    console.error('Error fetching newsletters:', error);
    res.status(500).json({ error: error.message });
  }
});

// Unsubscribe from a newsletter
router.post('/:emailId/unsubscribe', requireAuth, async (req: any, res) => {
  try {
    const { emailId } = req.params;

    // Get the email details
    const emailData = await (db as any).get(`
      SELECT analysis_result
      FROM email_analysis
      WHERE email_id = ? AND user_id = ?
    `, [emailId, req.user.id || 'default']);

    if (!emailData) {
      return res.status(404).json({ error: 'Newsletter not found' });
    }

    const unsubscribeLink = extractUnsubscribeLink(emailData.analysis_result);

    if (unsubscribeLink) {
      // Mark as unsubscribed in database
      await (db as any).run(`
        UPDATE email_analysis
        SET was_filtered = 1,
            filter_reason = 'unsubscribed'
        WHERE email_id = ?
      `, [emailId]);

      res.json({
        success: true,
        unsubscribeLink,
        message: 'Newsletter marked as unsubscribed. Visit the link to complete unsubscription.'
      });
    } else {
      res.status(400).json({ error: 'No unsubscribe link found' });
    }

  } catch (error: any) {
    console.error('Error unsubscribing:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get newsletter statistics
router.get('/stats', requireAuth, async (req: any, res) => {
  try {
    const stats = await (db as any).get(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN was_filtered = 1 THEN 1 END) as unsubscribed,
        COUNT(CASE WHEN analysis_result LIKE '%"priority":"high"%' THEN 1 END) as important
      FROM email_analysis
      WHERE
        user_id = ?
        AND analysis_result LIKE '%"emailType":"newsletter"%'
    `, [req.user.id || 'default']);

    // Get top senders
    const topSenders = await (db as any).all(`
      SELECT
        from_address,
        COUNT(*) as count
      FROM email_analysis
      WHERE
        user_id = ?
        AND analysis_result LIKE '%"emailType":"newsletter"%'
      GROUP BY from_address
      ORDER BY count DESC
      LIMIT 10
    `, [req.user.id || 'default']);

    res.json({
      totalNewsletters: stats.total,
      unsubscribed: stats.unsubscribed,
      important: stats.important,
      topSenders
    });

  } catch (error: any) {
    console.error('Error getting newsletter stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to extract unsubscribe link
function extractUnsubscribeLink(analysisResult: string): string | null {
  // Look for common unsubscribe patterns in the analysis
  const patterns = [
    /unsubscribe/i,
    /opt-out/i,
    /remove me/i,
    /email preferences/i,
    /manage subscription/i
  ];

  // This would need to be enhanced to actually extract URLs from email body
  // For now, return a placeholder
  return null;
}

export default router;