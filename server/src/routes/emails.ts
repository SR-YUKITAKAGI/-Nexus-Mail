import { Router } from 'express';
import { GmailService } from '../services/gmailService';
import { NewsletterDetector } from '../services/newsletterDetector';
import { requireAuth } from '../middleware/auth';

const router = Router();

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

export default router;