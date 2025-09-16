import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { UnifiedEmailAnalyzer } from '../services/unifiedEmailAnalyzer';
import { PurchaseExtractor } from '../services/purchaseExtractor';
import { google } from 'googleapis';

const router = Router();
const analyzer = new UnifiedEmailAnalyzer();
const purchaseExtractor = new PurchaseExtractor();

// Fetch large number of emails for testing
router.post('/fetch-bulk-emails', requireAuth, async (req: Request, res: Response) => {
  const { maxResults = 2000, startDate, endDate } = req.body;
  const user = req.user as any;

  if (!user.accessToken) {
    res.status(401).json({ error: 'No access token' });
    return;
  }

  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Build query
    let query = '';
    if (startDate && endDate) {
      query = `after:${startDate} before:${endDate}`;
    } else {
      // Default to last 6 months
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      query = `after:${sixMonthsAgo.toISOString().split('T')[0]}`;
    }

    console.log(`Fetching emails with query: ${query}, maxResults: ${maxResults}`);

    // Fetch messages in batches
    const allMessages = [];
    let pageToken = undefined;
    let totalFetched = 0;

    while (totalFetched < maxResults) {
      const response: any = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: Math.min(500, maxResults - totalFetched),
        pageToken,
      });

      if (response.data.messages) {
        allMessages.push(...response.data.messages);
        totalFetched += response.data.messages.length;
      }

      pageToken = response.data.nextPageToken;
      if (!pageToken || totalFetched >= maxResults) break;
    }

    console.log(`Fetched ${allMessages.length} message IDs`);

    // Get full message details in parallel batches
    const batchSize = 50;
    const fullMessages = [];

    for (let i = 0; i < allMessages.length; i += batchSize) {
      const batch = allMessages.slice(i, i + batchSize);
      const batchPromises = batch.map(async (msg) => {
        try {
          const message = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
          });
          return message.data;
        } catch (error) {
          console.error(`Failed to fetch message ${msg.id}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      fullMessages.push(...batchResults.filter(msg => msg !== null));

      // Progress update
      console.log(`Processed ${Math.min(i + batchSize, allMessages.length)} / ${allMessages.length} messages`);
    }

    res.json({
      success: true,
      totalFetched: fullMessages.length,
      messages: fullMessages,
    });
  } catch (error) {
    console.error('Bulk email fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// Analyze fetched emails and generate report
router.post('/analyze-bulk', requireAuth, async (req: Request, res: Response) => {
  const { messages } = req.body;
  const userId = (req.user as any).id;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Invalid messages array' });
    return;
  }

  try {
    console.log(`Starting bulk analysis of ${messages.length} emails`);

    const startTime = Date.now();
    interface AnalysisResults {
      totalAnalyzed: number;
      purchases: Array<{
        vendor: string;
        amount: number;
        currency: string;
        date: Date;
        confidence: number;
      }>;
      categories: Map<string, number>;
      emailTypes: Map<string, number>;
      priorities: { high: number; medium: number; low: number };
      sentiments: { positive: number; neutral: number; negative: number };
      contacts: Set<string>;
      events: Array<{
        title?: string;
        date?: string;
        location?: string;
      }>;
      tasks: string[];
      errors: Array<{
        messageId: string;
        error: string;
      }>;
      processingTime: number;
      averageProcessingTime: number;
      aiCost: number;
    }

    const results: AnalysisResults = {
      totalAnalyzed: 0,
      purchases: [],
      categories: new Map<string, number>(),
      emailTypes: new Map<string, number>(),
      priorities: { high: 0, medium: 0, low: 0 },
      sentiments: { positive: 0, neutral: 0, negative: 0 },
      contacts: new Set<string>(),
      events: [],
      tasks: [],
      errors: [],
      processingTime: 0,
      averageProcessingTime: 0,
      aiCost: 0,
    };

    // Process emails in batches
    const batchSize = 10;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);

      const batchPromises = batch.map(async (message: any) => {
        try {
          // Extract email content
          const headers = message.payload?.headers || [];
          const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
          const from = headers.find((h: any) => h.name === 'From')?.value || '';
          const to = headers.find((h: any) => h.name === 'To')?.value || '';
          const date = headers.find((h: any) => h.name === 'Date')?.value || '';

          // Get body
          let body = '';
          if (message.payload?.body?.data) {
            body = Buffer.from(message.payload.body.data, 'base64').toString();
          } else if (message.payload?.parts) {
            const textPart = message.payload.parts.find((p: any) => p.mimeType === 'text/plain');
            if (textPart?.body?.data) {
              body = Buffer.from(textPart.body.data, 'base64').toString();
            }
          }

          // Skip if no content
          if (!body && !subject) return null;

          // Analyze with unified analyzer
          const analysis = await analyzer.analyzeEmail(
            body.substring(0, 3000), // Limit body size
            subject,
            from,
            message.id,
            to
          );

          if (analysis) {
            // Update statistics
            results.totalAnalyzed++;

            // Email type and category
            if (analysis.emailType) {
              results.emailTypes.set(
                analysis.emailType,
                (results.emailTypes.get(analysis.emailType) || 0) + 1
              );
            }

            if (analysis.category) {
              results.categories.set(
                analysis.category,
                (results.categories.get(analysis.category) || 0) + 1
              );
            }

            // Priority and sentiment
            if (analysis.priority) {
              results.priorities[analysis.priority]++;
            }

            if (analysis.discovery?.sentiment) {
              results.sentiments[analysis.discovery.sentiment]++;
            }

            // Extract purchases
            if (analysis.purchase?.isPurchase) {
              const purchase = await purchaseExtractor.extractPurchase(
                body,
                subject,
                from,
                message.id,
                date
              );

              if (purchase) {
                results.purchases.push({
                  vendor: purchase.vendor,
                  amount: purchase.amount,
                  currency: purchase.currency,
                  date: purchase.date,
                  confidence: analysis.purchase.confidence,
                });
              }
            }

            // Extract contacts
            if (analysis.contacts) {
              analysis.contacts.forEach(contact => {
                results.contacts.add(contact.email);
              });
            }

            // Extract events
            if (analysis.event?.isEvent) {
              results.events.push({
                title: analysis.event.title,
                date: analysis.event.date,
                location: analysis.event.location,
              });
            }

            // Extract tasks
            if (analysis.discovery?.actionItems) {
              results.tasks.push(...analysis.discovery.actionItems);
            }
          }

          return analysis;
        } catch (error) {
          console.error(`Error analyzing message ${message.id}:`, error);
          results.errors.push({
            messageId: message.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return null;
        }
      });

      await Promise.all(batchPromises);

      // Progress update
      console.log(`Analyzed ${Math.min(i + batchSize, messages.length)} / ${messages.length} emails`);
    }

    // Calculate final statistics
    results.processingTime = Date.now() - startTime;
    results.averageProcessingTime = results.processingTime / messages.length;

    // Estimate AI cost (Claude Haiku pricing)
    // ~1000 tokens per email, $0.25 per million input tokens
    const estimatedTokens = results.totalAnalyzed * 1000;
    results.aiCost = (estimatedTokens / 1000000) * 0.25;

    // Convert Maps to objects for JSON serialization
    const report = {
      ...results,
      categories: Object.fromEntries(results.categories),
      emailTypes: Object.fromEntries(results.emailTypes),
      contacts: Array.from(results.contacts),
      summary: {
        totalEmails: messages.length,
        successfullyAnalyzed: results.totalAnalyzed,
        failureRate: ((messages.length - results.totalAnalyzed) / messages.length * 100).toFixed(2) + '%',
        purchasesDetected: results.purchases.length,
        totalPurchaseAmount: results.purchases.reduce((sum, p) => sum + p.amount, 0),
        uniqueContacts: results.contacts.size,
        eventsFound: results.events.length,
        tasksExtracted: results.tasks.length,
        processingTimeSeconds: (results.processingTime / 1000).toFixed(2),
        estimatedCostUSD: results.aiCost.toFixed(4),
      },
    };

    res.json({
      success: true,
      report,
    });
  } catch (error) {
    console.error('Bulk analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze emails' });
  }
});

// Get analysis statistics
router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const stats = analyzer.getStats();

    res.json({
      analyzer: stats,
      message: 'Analysis system is operational',
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export default router;