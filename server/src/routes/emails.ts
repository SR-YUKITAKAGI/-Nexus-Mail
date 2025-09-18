import { Router } from 'express';
import { GmailService } from '../services/gmailService';
import { NewsletterDetector } from '../services/newsletterDetector';
import { ContactExtractor } from '../services/contactExtractor';
import { CalendarExtractor } from '../services/calendarExtractor';
import { requireAuth } from '../middleware/auth';
import { getOAuth2Client } from '../utils/auth';
import { google } from 'googleapis';
import axios from 'axios';

const router = Router();
const contactExtractor = new ContactExtractor();
const calendarExtractor = new CalendarExtractor();

// Get email threads
router.get('/threads', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { q, maxResults } = req.query;
    
    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const threads = await gmailService.getThreads(
      q as string,
      parseInt(maxResults as string) || 20
    );
    
    // Format threads for frontend with proper body content and newsletter detection
    const formattedThreads = threads.map((thread: any) => {
      const messages = thread.messages || [];
      const firstMessage = messages[0] || {};

      // Contact extraction
      if (firstMessage.from && firstMessage.body) {
        try {
          const contactInfo = contactExtractor.extractFromEmail(
            firstMessage.body,
            firstMessage.from.match(/<(.+?)>/)?.[1] || firstMessage.from,
            thread.subject
          );

          // Send to contacts API
          axios.post('http://localhost:3001/api/contacts/extract', {
            emailBody: firstMessage.body,
            senderEmail: firstMessage.from.match(/<(.+?)>/)?.[1] || firstMessage.from
          }, {
            headers: {
              'Authorization': req.headers.authorization,
              'Cookie': req.headers.cookie
            }
          }).catch(err => console.log('Contact extraction skipped:', err.message));
        } catch (error) {
          console.log('Contact extraction error:', error);
        }
      }

      // Calendar extraction
      if (firstMessage.body) {
        try {
          const events = calendarExtractor.extractEvents(
            firstMessage.body,
            thread.subject,
            firstMessage.from,
            firstMessage.id
          );

          if (events.length > 0) {
            // Send to calendar API
            axios.post('http://localhost:3001/api/calendar/extract', {
              emailBody: firstMessage.body,
              subject: thread.subject,
              from: firstMessage.from,
              emailId: firstMessage.id
            }, {
              headers: {
                'Authorization': req.headers.authorization,
                'Cookie': req.headers.cookie
              }
            }).catch(err => console.log('Calendar extraction skipped:', err.message));
          }
        } catch (error) {
          console.log('Calendar extraction error:', error);
        }
      }

      // Purchase extraction
      if (firstMessage.body) {
        try {
          axios.post('http://localhost:3001/api/purchases/extract', {
            emailBody: firstMessage.body,
            subject: thread.subject,
            from: firstMessage.from,
            emailId: firstMessage.id,
            timestamp: firstMessage.timestamp || thread.timestamp,
            emailSubject: thread.subject,
            emailFrom: firstMessage.from
          }, {
            headers: {
              'Authorization': req.headers.authorization,
              'Cookie': req.headers.cookie
            }
          }).catch(err => console.log('Purchase extraction skipped:', err.message));
        } catch (error) {
          console.log('Purchase extraction error:', error);
        }
      }
      
      // メールタイプ判定
      const emailTypeCheck = NewsletterDetector.detectEmailType({
        subject: thread.subject,
        from: firstMessage.from,
        body: firstMessage.body,
        snippet: thread.snippet
      });
      
      const category = emailTypeCheck.type;
      
      const newsletterCategory = emailTypeCheck.type === 'newsletter'
        ? NewsletterDetector.categorizeNewsletter({
            subject: thread.subject,
            from: firstMessage.from,
            body: firstMessage.body
          })
        : null;
      
      return {
        id: thread.id,
        participants: thread.participants || [],
        subject: thread.subject || 'No Subject',
        lastMessage: thread.snippet || '',
        summary: thread.snippet || '',
        timestamp: thread.timestamp || new Date().toISOString(),
        unreadCount: thread.unreadCount || 0,
        hasAttachment: thread.hasAttachment || false,
        isStarred: messages[0]?.labelIds?.includes('STARRED') || false,
        category,
        emailType: emailTypeCheck.type,
        typeConfidence: emailTypeCheck.confidence,
        newsletterCategory,
        messages: messages.map((msg: any) => ({
          id: msg.id,
          from: msg.from || '',
          timestamp: msg.date || new Date().toISOString(),
          content: msg.body || msg.snippet || '', // Use body if available, fallback to snippet
          contentHtml: msg.bodyHtml || '', // HTML version of the body
          isExpanded: false,
        })),
      };
    });
    
    res.json({ threads: formattedThreads });
  } catch (error) {
    console.error('Error fetching threads:', error);
    res.status(500).json({ error: 'Failed to fetch email threads' });
  }
});

// Get single thread
router.get('/threads/:threadId', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { threadId } = req.params;
    
    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const thread = await gmailService.getThread(threadId);
    
    res.json({ thread });
  } catch (error) {
    console.error('Error fetching thread:', error);
    res.status(500).json({ error: 'Failed to fetch email thread' });
  }
});

// Image proxy endpoint for email images
router.get('/image-proxy', requireAuth, async (req, res) => {
  try {
    const imageUrl = req.query.url as string;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    // Set appropriate referer based on domain
    let referer = '';
    if (imageUrl.includes('rakuten-sec.co.jp')) {
      referer = 'https://www.rakuten-sec.co.jp/';
    } else if (imageUrl.includes('amazon')) {
      referer = 'https://www.amazon.co.jp/';
    }

    // Fetch the image as buffer to handle properly
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        ...(referer && { 'Referer': referer })
      }
    });

    // Set appropriate headers with CORS support
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // Remove X-Frame-Options to allow iframe embedding
    res.removeHeader('X-Frame-Options');

    // Send the buffer as response
    res.send(Buffer.from(response.data));
  } catch (error: any) {
    const imageUrl = req.query.url as string;
    console.error('Error proxying image:', {
      url: imageUrl,
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText
    });

    // Set CORS headers even for errors
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // Send a 1x1 transparent GIF as placeholder
    const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).send(transparentGif);
  }
});

// Send email
router.post('/send', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { to, subject, body, threadId } = req.body;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const result = await gmailService.sendEmail(to, subject, body, threadId);

    res.json({ success: true, messageId: result.id });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Toggle star
router.post('/star/:messageId', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { messageId } = req.params;
    const { starred } = req.body;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const result = await gmailService.toggleStar(messageId, starred);

    res.json(result);
  } catch (error) {
    console.error('Error toggling star:', error);
    res.status(500).json({ error: 'Failed to toggle star' });
  }
});

// Get single message
router.get('/message/:messageId', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { messageId } = req.params;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const message = await gmailService.getMessage(messageId);

    res.json({ message });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

// Mark as read
router.post('/read/:messageId', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { messageId } = req.params;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const result = await gmailService.markAsRead(messageId);

    res.json(result);
  } catch (error) {
    console.error('Error marking as read:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// Mark as unread
router.post('/unread/:messageId', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { messageId } = req.params;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const result = await gmailService.markAsUnread(messageId);

    res.json(result);
  } catch (error) {
    console.error('Error marking as unread:', error);
    res.status(500).json({ error: 'Failed to mark as unread' });
  }
});

// Archive email
router.post('/archive/:messageId', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { messageId } = req.params;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const result = await gmailService.archiveMessage(messageId);

    res.json(result);
  } catch (error) {
    console.error('Error archiving message:', error);
    res.status(500).json({ error: 'Failed to archive message' });
  }
});

// Delete email
router.delete('/message/:messageId', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { messageId } = req.params;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const result = await gmailService.deleteMessage(messageId);

    res.json(result);
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Search emails
router.get('/search', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { q, maxResults } = req.query;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const threads = await gmailService.searchMessages(
      q as string,
      parseInt(maxResults as string) || 20
    );

    res.json({ threads });
  } catch (error) {
    console.error('Error searching emails:', error);
    res.status(500).json({ error: 'Failed to search emails' });
  }
});

// Get attachment
router.get('/attachment/:messageId/:attachmentId', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { messageId, attachmentId } = req.params;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const attachment = await gmailService.getAttachment(messageId, attachmentId);

    res.json(attachment);
  } catch (error) {
    console.error('Error getting attachment:', error);
    res.status(500).json({ error: 'Failed to get attachment' });
  }
});

// Create draft
router.post('/draft', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { to, subject, body } = req.body;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const draft = await gmailService.createDraft(to, subject, body);

    res.json(draft);
  } catch (error) {
    console.error('Error creating draft:', error);
    res.status(500).json({ error: 'Failed to create draft' });
  }
});

// Update draft
router.put('/draft/:draftId', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { draftId } = req.params;
    const { to, subject, body } = req.body;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const draft = await gmailService.updateDraft(draftId, to, subject, body);

    res.json(draft);
  } catch (error) {
    console.error('Error updating draft:', error);
    res.status(500).json({ error: 'Failed to update draft' });
  }
});

// Get drafts
router.get('/drafts', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const drafts = await gmailService.getDrafts();

    res.json({ drafts });
  } catch (error) {
    console.error('Error getting drafts:', error);
    res.status(500).json({ error: 'Failed to get drafts' });
  }
});

// Batch operations
router.post('/batch', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;
    const { messageIds, action } = req.body;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);

    const results = await Promise.all(
      messageIds.map(async (messageId: string) => {
        switch (action) {
          case 'star':
            return gmailService.toggleStar(messageId, true);
          case 'unstar':
            return gmailService.toggleStar(messageId, false);
          case 'archive':
            return gmailService.archiveMessage(messageId);
          case 'delete':
            return gmailService.deleteMessage(messageId);
          case 'markAsRead':
            return gmailService.markAsRead(messageId);
          case 'markAsUnread':
            return gmailService.markAsUnread(messageId);
          default:
            return { error: 'Invalid action' };
        }
      })
    );

    res.json({ results });
  } catch (error) {
    console.error('Error performing batch operation:', error);
    res.status(500).json({ error: 'Failed to perform batch operation' });
  }
});

// Get analyzed emails with full details
router.get('/analyzed', requireAuth, async (req: any, res: any) => {
  const userId = req.user.id;
  const limit = parseInt(req.query.limit as string) || 50;

  try {
    const auth = await getOAuth2Client(userId);
    const gmail = google.gmail({ version: 'v1', auth });

    // Fetch recent emails
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: limit,
      q: 'after:2025-01-01'
    });

    if (!response.data.messages) {
      return res.json({ emails: [] });
    }

    // Import UnifiedEmailAnalyzer
    const { UnifiedEmailAnalyzer } = await import('../services/unifiedEmailAnalyzer');
    const analyzer = new UnifiedEmailAnalyzer();

    // Fetch full messages with analysis
    const emails = [];

    for (const message of response.data.messages) {
      try {
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!
        });

        const headers = fullMessage.data.payload?.headers || [];
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
        const from = headers.find((h: any) => h.name === 'From')?.value || '';
        const date = headers.find((h: any) => h.name === 'Date')?.value || '';

        // Get body
        let body = '';
        if (fullMessage.data.payload?.body?.data) {
          body = Buffer.from(fullMessage.data.payload.body.data, 'base64').toString();
        } else if (fullMessage.data.payload?.parts) {
          const textPart = fullMessage.data.payload.parts.find((p: any) => p.mimeType === 'text/plain');
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64').toString();
          }
        }

        // Get or perform analysis
        const analysis = await analyzer.analyzeEmail(
          body.substring(0, 3000),
          subject,
          from,
          message.id!
        );

        if (analysis) {
          // Check if it was filtered
          const wasFiltered = analysis.emailType === 'newsletter' ||
                             analysis.emailType === 'credit_card_statement' ||
                             analysis.emailType === 'notification';

          const filterReason = analysis.emailType === 'newsletter' ? 'Promotional' :
                              analysis.emailType === 'credit_card_statement' ? 'Credit Card Statement' :
                              analysis.emailType === 'notification' ? 'Automated' : '';

          emails.push({
            emailId: message.id,
            subject,
            from,
            date,
            analysis,
            wasFiltered,
            filterReason
          });
        }
      } catch (error) {
        console.error(`Error processing email ${message.id}:`, error);
      }
    }

    return res.json({ emails });
  } catch (error) {
    console.error('Error fetching analyzed emails:', error);
    return res.status(500).json({ error: 'Failed to fetch analyzed emails' });
  }
});

// Get AI-analyzed labels from emails
router.get('/labels', requireAuth, async (req, res) => {
  try {
    const user = req.user as any;

    // Get recent emails to extract labels from
    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const threads = await gmailService.getThreads(
      `after:${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}`,
      500
    );

    // Extract labels from threads
    const labelCounts = new Map<string, number>();

    threads.forEach((thread: any) => {
      // Extract from AI analysis if available
      if (thread.analysis) {
        if (thread.analysis.labels && Array.isArray(thread.analysis.labels)) {
          thread.analysis.labels.forEach((label: string) => {
            if (label && !['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH'].includes(label.toUpperCase())) {
              labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
            }
          });
        }

        // Also count custom categories
        if (thread.analysis.customCategory &&
            thread.analysis.customCategory !== 'primary' &&
            thread.analysis.customCategory !== 'newsletter' &&
            thread.analysis.customCategory !== 'service_announcement') {
          labelCounts.set(thread.analysis.customCategory,
            (labelCounts.get(thread.analysis.customCategory) || 0) + 1);
        }
      }

      // Extract from Gmail labels
      if (thread.messages && thread.messages[0] && thread.messages[0].labels) {
        thread.messages[0].labels.forEach((label: string) => {
          // Skip system labels
          if (!['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'IMPORTANT', 'STARRED', 'UNREAD'].includes(label.toUpperCase())) {
            labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
          }
        });
      }

      // Extract from category field
      if (thread.category &&
          thread.category !== 'primary' &&
          thread.category !== 'newsletter' &&
          thread.category !== 'service_announcement') {
        const categoryLabel = thread.category.charAt(0).toUpperCase() + thread.category.slice(1);
        labelCounts.set(categoryLabel, (labelCounts.get(categoryLabel) || 0) + 1);
      }
    });

    // Convert to array and sort by count
    const labels = Array.from(labelCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15); // Top 15 labels

    res.json({ labels });
  } catch (error) {
    console.error('Error fetching labels:', error);
    res.status(500).json({ error: 'Failed to fetch labels' });
  }
});

export default router;