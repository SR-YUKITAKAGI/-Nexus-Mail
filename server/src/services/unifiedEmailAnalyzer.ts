import Anthropic from '@anthropic-ai/sdk';
import NodeCache from 'node-cache';
import { db } from './database';

interface UnifiedAnalysisResult {
  emailType: 'purchase' | 'credit_card_statement' | 'newsletter' | 'personal' | 'work' | 'notification' | 'spam' | 'other';
  category: string;
  priority: 'high' | 'medium' | 'low';
  isCreditCardStatement?: boolean;

  // AI-generated labels for categorization
  labels?: string[];
  customCategory?: string;

  // Purchase data
  purchase?: {
    isPurchase: boolean;
    confidence: number;
    vendor?: string;
    amount?: number;
    currency?: string;
    orderId?: string;
    items?: Array<{ name: string; quantity: number; price: number }>;
    trackingNumber?: string;
    deliveryDate?: string;
  };

  // Contact data
  contacts?: {
    name?: string;
    email: string;
    company?: string;
    phone?: string;
    role?: string;
    relationship?: 'business' | 'personal' | 'service' | 'unknown';
  }[];

  // Discovery/Insights
  discovery?: {
    keyTopics: string[];
    actionItems?: string[];
    deadlines?: Array<{ task: string; date: string }>;
    mentions?: string[];
    sentiment: 'positive' | 'neutral' | 'negative';
    importance: number; // 1-10
  };

  // Calendar/Event data
  event?: {
    isEvent: boolean;
    title?: string;
    date?: string;
    time?: string;
    location?: string;
    meetingLink?: string;
  };

  // Summary
  summary: string;
  suggestedActions?: string[];
  // autoReplyTemplate removed - will generate on demand only
}

export class UnifiedEmailAnalyzer {
  private anthropic: Anthropic | null = null;
  private cache: NodeCache;
  private isInitialized = false;
  private mockMode = false;
  private promotionalSenders: Set<string> = new Set();
  private senderFrequency: Map<string, number> = new Map();

  constructor() {
    // Cache for 24 hours
    this.cache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const useMock = process.env.USE_MOCK_AI === 'true';

    if (useMock) {
      this.mockMode = true;
      this.isInitialized = true;
      console.log('🎭 Unified Email Analyzer in MOCK mode (for testing)');
    } else if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.isInitialized = true;
      console.log('✅ Unified Email Analyzer initialized with Claude API');
    } else {
      console.log('⚠️ Unified Email Analyzer not initialized (no ANTHROPIC_API_KEY)');
    }
  }

  // Check if sender is automated
  private isAutomatedSender(email: string): boolean {
    const skipPatterns = [
      /noreply/i,
      /no-reply/i,
      /donotreply/i,
      /mailer-daemon/i,
      /postmaster/i,
      /notification@/i,
      /alerts?@/i,
      /updates?@/i
    ];

    return skipPatterns.some(pattern => pattern.test(email));
  }

  // Check if email should be analyzed
  private shouldAnalyze(from: string, subject: string): boolean {
    // Skip automated emails
    const skipPatterns = [
      /noreply/i,
      /no-reply/i,
      /donotreply/i,
      /mailer-daemon/i,
      /postmaster/i,
      /unsubscribe/i,
      /notification@/i
    ];

    if (skipPatterns.some(pattern => pattern.test(from))) {
      return false;
    }

    // Skip if subject indicates automated email
    const skipSubjects = [
      /^auto:/i,
      /^automatic reply/i,
      /^out of office/i,
      /^undelivered mail/i
    ];

    if (skipSubjects.some(pattern => pattern.test(subject))) {
      return false;
    }

    return true;
  }

  // Check if email is a credit card statement
  private isCreditCardStatement(from: string, subject: string, body: string): boolean {
    const fromLower = from.toLowerCase();
    const subjectLower = subject.toLowerCase();
    const bodyLower = body.toLowerCase().substring(0, 1000);

    // Credit card company domains and keywords
    const creditCardCompanies = [
      'visa', 'mastercard', 'jcb', 'amex', 'americanexpress',
      'diners', 'discover', 'unionpay'
    ];

    const creditCardBanks = [
      'smbc', 'mufg', 'mizuho', 'rakuten-card', 'aeon',
      'saison', 'orico', 'jaccs', 'cedyna', 'aplus',
      'epos', 'viewcard', 'dccard', 'uccard', 'nicos'
    ];

    const statementKeywords = [
      '明細', '利用明細', 'statement', '請求', 'billing',
      'ご利用代金', '引き落とし', '支払い', 'payment due',
      'カード利用', 'card usage', '今月のご請求',
      'monthly statement', '月次明細'
    ];

    // Check if from a credit card company or bank
    const isFromCreditCard = [...creditCardCompanies, ...creditCardBanks].some(company =>
      fromLower.includes(company)
    );

    // Check for statement keywords
    const hasStatementKeyword = statementKeywords.some(keyword =>
      subjectLower.includes(keyword) || bodyLower.includes(keyword)
    );

    // Check for multiple transaction patterns (indicates statement)
    const multipleTransactionPattern = /\d{1,2}\/\d{1,2}.*¥[\d,]+.*\d{1,2}\/\d{1,2}.*¥[\d,]+/;
    const hasMultipleTransactions = multipleTransactionPattern.test(body);

    return isFromCreditCard && (hasStatementKeyword || hasMultipleTransactions);
  }

  // Check if email is promotional based on patterns
  private isPromotionalEmail(from: string, subject: string, body: string): boolean {
    const fromLower = from.toLowerCase();
    const subjectLower = subject.toLowerCase();
    const bodyLower = body.toLowerCase().substring(0, 1000); // Check first 1000 chars

    // Promotional keywords in subject
    const promoSubjectKeywords = [
      'sale', 'セール', 'キャンペーン', 'campaign', 'offer', '特価',
      'discount', '割引', 'クーポン', 'coupon', 'deal', 'お得',
      'limited time', '期間限定', 'special', '特別', 'save',
      'free shipping', '送料無料', 'newsletter', 'メルマガ',
      '新商品', 'new arrival', 'おすすめ', 'recommendation'
    ];

    // Promotional senders patterns
    const promoSenderPatterns = [
      /marketing@/i, /promo@/i, /newsletter@/i, /noreply@/i,
      /news@/i, /info@/i, /updates@/i, /deals@/i,
      /store@/i, /shop@/i, /sales@/i
    ];

    // Check if sender is already marked as promotional
    const senderEmail = from.match(/<(.+)>/)?.[1] || from;
    if (this.promotionalSenders.has(senderEmail)) {
      console.log(`Skipping known promotional sender: ${senderEmail}`);
      return true;
    }

    // Check promotional patterns
    const hasPromoKeyword = promoSubjectKeywords.some(keyword =>
      subjectLower.includes(keyword) || bodyLower.includes(keyword)
    );

    const hasPromoSender = promoSenderPatterns.some(pattern =>
      pattern.test(fromLower)
    );

    // Check for unsubscribe links (strong indicator of promotional)
    const hasUnsubscribe = bodyLower.includes('unsubscribe') ||
                          bodyLower.includes('配信停止') ||
                          bodyLower.includes('メール配信');

    // Track sender frequency
    const frequency = this.senderFrequency.get(senderEmail) || 0;
    this.senderFrequency.set(senderEmail, frequency + 1);

    // If sender sends more than 5 emails and most are promotional, mark as promotional sender
    if (frequency > 5 && (hasPromoKeyword || hasUnsubscribe)) {
      this.promotionalSenders.add(senderEmail);
      console.log(`Marked ${senderEmail} as promotional sender (frequency: ${frequency})`);
    }

    return hasPromoSender || (hasPromoKeyword && hasUnsubscribe);
  }

  async analyzeEmail(
    emailBody: string,
    subject: string,
    from: string,
    emailId: string,
    to?: string,
    cc?: string,
    userId: string = 'default'
  ): Promise<UnifiedAnalysisResult | null> {
    if (!this.isInitialized) {
      console.log('Unified Email Analyzer not initialized');
      return null;
    }

    // Mock mode for testing without API credits
    if (this.mockMode) {
      return this.generateMockAnalysis(subject, from);
    }

    if (!this.anthropic) {
      console.log('No Anthropic client available');
      return null;
    }

    // Check if we should skip this email
    if (!this.shouldAnalyze(from, subject)) {
      console.log(`Skipping automated email: ${emailId}`);
      return {
        emailType: 'notification',
        category: 'Automated',
        priority: 'low',
        labels: ['Automated', 'System'],
        customCategory: 'Service Announce',
        summary: 'Automated notification email',
        discovery: {
          keyTopics: [],
          sentiment: 'neutral',
          importance: 1
        }
      };
    }

    // Check if it's a credit card statement
    if (this.isCreditCardStatement(from, subject, emailBody)) {
      console.log(`Detected credit card statement: ${emailId} from ${from}`);
      return {
        emailType: 'credit_card_statement',
        category: 'Finance',
        priority: 'high',
        isCreditCardStatement: true,
        labels: ['Credit Card', 'Statement', 'Finance', 'Billing'],
        customCategory: 'Credit Statement',
        summary: 'Credit card statement - contains aggregated purchases',
        discovery: {
          keyTopics: ['credit card', 'statement', 'billing'],
          sentiment: 'neutral',
          importance: 8
        },
        contacts: [{
          email: from.match(/<(.+)>/)?.[1] || from,
          name: from.split('<')[0]?.trim() || from.split('@')[0],
          relationship: 'service'
        }]
      };
    }

    // Check if it's a promotional email
    if (this.isPromotionalEmail(from, subject, emailBody)) {
      console.log(`Skipping promotional email: ${emailId} from ${from}`);
      return {
        emailType: 'newsletter',
        category: 'Marketing',
        priority: 'low',
        labels: ['Newsletter', 'Promotion'],
        customCategory: 'Mail Magazine',
        summary: 'Promotional/Marketing email',
        discovery: {
          keyTopics: ['promotion', 'marketing'],
          sentiment: 'neutral',
          importance: 1
        },
        contacts: [{
          email: from.match(/<(.+)>/)?.[1] || from,
          name: from.split('<')[0]?.trim() || from.split('@')[0],
          relationship: 'service'
        }]
      };
    }

    // First check database (permanent storage)
    const dbResult = await db.getAnalysis(emailId, userId);
    if (dbResult) {
      console.log(`Using database cached analysis for email ${emailId}`);
      // Also put in memory cache for faster access
      this.cache.set(`unified_${emailId}`, dbResult);
      return dbResult;
    }

    // Then check memory cache
    const cacheKey = `unified_${emailId}`;
    const cached = this.cache.get<UnifiedAnalysisResult>(cacheKey);
    if (cached) {
      console.log(`Using memory cached unified analysis for email ${emailId}`);
      // Save to database for persistence
      await db.saveAnalysis(
        emailId,
        userId,
        cached,
        new Date(),
        from,
        subject,
        false
      );
      return cached;
    }

    try {
      // Truncate for token efficiency
      const truncatedBody = emailBody.substring(0, 3000);

      const prompt = `Analyze this email comprehensively for multiple features. This is primarily Japanese business/e-commerce emails.

Email Subject: ${subject}
From: ${from}
${to ? `To: ${to}` : ''}
${cc ? `CC: ${cc}` : ''}
Body: ${truncatedBody}

Analyze and return ONLY valid JSON with this exact structure:
{
  "emailType": "purchase|newsletter|personal|work|notification|spam|other",
  "category": "Shopping|Business|Personal|Travel|Finance|Marketing|Support|Other",
  "priority": "high|medium|low",
  "labels": ["array of 1-5 relevant labels/tags in English"],
  "customCategory": "specific category if not in standard list or null",

  "purchase": {
    "isPurchase": boolean,
    "confidence": 0.0-1.0,
    "vendor": "string or null",
    "amount": number or null,
    "currency": "JPY|USD|EUR or null",
    "orderId": "string or null",
    "items": [{"name": "string", "quantity": number, "price": number}] or null,
    "trackingNumber": "string or null",
    "deliveryDate": "YYYY-MM-DD or null"
  },

  "contacts": [
    {
      "name": "string or null",
      "email": "string",
      "company": "string or null",
      "phone": "string or null",
      "role": "string or null",
      "relationship": "business|personal|service|unknown"
    }
  ] or null,

  "discovery": {
    "keyTopics": ["array of main topics discussed"],
    "actionItems": ["tasks mentioned that need action"] or null,
    "deadlines": [{"task": "string", "date": "YYYY-MM-DD"}] or null,
    "mentions": ["people/companies mentioned"] or null,
    "sentiment": "positive|neutral|negative",
    "importance": 1-10
  },

  "event": {
    "isEvent": boolean,
    "title": "string or null",
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null",
    "location": "string or null",
    "meetingLink": "URL or null"
  } or null,

  "summary": "1-2 sentence summary in Japanese",
  "suggestedActions": ["array of suggested actions in Japanese"] or null,
  "autoReplyTemplate": null
}

IMPORTANT RULES:
1. Purchase detection:
   - Look for: 注文確認, 購入完了, 決済完了, ご注文, お買い上げ, 領収書, 請求書
   - Extract tracking: 配送番号, 追跡番号, お問い合わせ番号
   - Delivery date: お届け予定日, 配送予定日

2. Contact extraction:
   - Extract sender's info from email header and signature
   - Look for: 担当者, 営業, カスタマーサポート
   - Extract phone: 電話, TEL, 携帯
   - Identify relationship type from context

3. Discovery insights:
   - Extract main topics and themes
   - Find action items: TODO, やること, 要対応, お願い
   - Find deadlines: 締切, 期限, まで
   - Rate importance based on urgency words and sender

4. Event detection:
   - Look for: 会議, ミーティング, イベント, セミナー
   - Extract: 日時, 場所, 会場, Zoom/Teams links

5. Email categorization:
   - Determine primary purpose and type
   - Set priority based on content urgency
   - Generate 1-5 relevant labels for organizing (e.g., "Invoice", "Shipping", "Meeting", "Project Alpha", "Q4 Report")
   - If email doesn't fit standard categories, provide customCategory

Return ONLY the JSON, no other text.`;

      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      // Parse response
      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      let jsonStr = content.text;
      jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');

      const result = JSON.parse(jsonStr) as UnifiedAnalysisResult;

      // Cache the result in memory
      this.cache.set(cacheKey, result);

      // Save to database for persistence
      await db.saveAnalysis(
        emailId,
        userId,
        result,
        new Date(),
        from,
        subject,
        false
      );

      // Save extracted contacts to database
      if (result.contacts && result.contacts.length > 0) {
        for (const contact of result.contacts) {
          try {
            // Parse the from field to extract name if available
            const fromParts = from.match(/^(.*?)\s*<(.+)>$/);
            const contactEmail = contact.email || (fromParts ? fromParts[2] : from);
            const contactName = contact.name || (fromParts ? fromParts[1] : contactEmail.split('@')[0]);

            await db.saveContact({
              email: contactEmail.toLowerCase(),
              name: contactName,
              company: contact.company,
              phone: contact.phone,
              position: contact.role,
              sourceEmailIds: [emailId],
              firstEmailDate: new Date(),
              lastEmailDate: new Date(),
              totalEmailsReceived: 1,
              relationshipScore: 10,
              metadata: {
                relationship: contact.relationship || 'unknown',
                extractedFrom: emailId
              }
            }, userId);

            console.log(`Saved contact: ${contactEmail} from email ${emailId}`);
          } catch (error) {
            console.error(`Error saving contact from email ${emailId}:`, error);
          }
        }
      }

      // Also save the sender as a contact if not already processed
      try {
        const fromParts = from.match(/^(.*?)\s*<(.+)>$/);
        const senderEmail = fromParts ? fromParts[2] : from;
        const senderName = fromParts ? fromParts[1] : senderEmail.split('@')[0];

        // Check if this is a valid email to save as contact
        if (!this.isAutomatedSender(senderEmail)) {
          await db.saveContact({
            email: senderEmail.toLowerCase(),
            name: senderName,
            sourceEmailIds: [emailId],
            firstEmailDate: new Date(),
            lastEmailDate: new Date(),
            totalEmailsReceived: 1,
            relationshipScore: 5,
            metadata: {
              extractedFrom: emailId,
              emailType: result.emailType
            }
          }, userId);
        }
      } catch (error) {
        console.error(`Error saving sender contact from email ${emailId}:`, error);
      }

      console.log(`Unified analysis complete for email ${emailId}:`, {
        type: result.emailType,
        category: result.category,
        priority: result.priority,
        isPurchase: result.purchase?.isPurchase,
        contactsFound: result.contacts?.length || 0,
        importance: result.discovery?.importance
      });

      return result;
    } catch (error) {
      console.error('Unified analysis error:', error);
      return null;
    }
  }

  // Batch analyze with rate limiting
  async batchAnalyze(
    emails: Array<{
      body: string;
      subject: string;
      from: string;
      emailId: string;
      to?: string;
      cc?: string;
    }>
  ): Promise<Map<string, UnifiedAnalysisResult>> {
    const results = new Map<string, UnifiedAnalysisResult>();

    // Filter out emails that shouldn't be analyzed
    const emailsToAnalyze = emails.filter(email =>
      this.shouldAnalyze(email.from, email.subject)
    );

    console.log(`Analyzing ${emailsToAnalyze.length} of ${emails.length} emails (skipping automated)`);

    // Process in smaller batches to avoid rate limits
    const batchSize = 3;
    for (let i = 0; i < emailsToAnalyze.length; i += batchSize) {
      const batch = emailsToAnalyze.slice(i, i + batchSize);
      const promises = batch.map(email =>
        this.analyzeEmail(
          email.body,
          email.subject,
          email.from,
          email.emailId,
          email.to,
          email.cc
        )
      );

      const batchResults = await Promise.all(promises);

      batchResults.forEach((result, index) => {
        if (result) {
          results.set(batch[index].emailId, result);
        }
      });

      // Rate limiting delay
      if (i + batchSize < emailsToAnalyze.length) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    // Add skipped emails with minimal data
    emails.forEach(email => {
      if (!results.has(email.emailId) && !this.shouldAnalyze(email.from, email.subject)) {
        results.set(email.emailId, {
          emailType: 'notification',
          category: 'Automated',
          priority: 'low',
          summary: 'Automated email',
          discovery: {
            keyTopics: [],
            sentiment: 'neutral',
            importance: 1
          }
        });
      }
    });

    return results;
  }

  getStats(): {
    cacheSize: number;
    cacheHits: number;
    isEnabled: boolean;
    promotionalSenders: number;
    totalSenders: number;
  } {
    return {
      cacheSize: this.cache.keys().length,
      cacheHits: this.cache.getStats().hits,
      isEnabled: this.isInitialized,
      promotionalSenders: this.promotionalSenders.size,
      totalSenders: this.senderFrequency.size
    };
  }

  clearCache(): void {
    this.cache.flushAll();
    console.log('Unified analysis cache cleared');
  }

  // Generate mock analysis for testing
  private generateMockAnalysis(subject: string, from: string): UnifiedAnalysisResult {
    const random = Math.random();

    // More accurate purchase detection keywords
    const purchaseKeywords = [
      'order', '注文', '購入', 'receipt', '領収書', 'invoice', '請求書',
      'payment', '決済', 'お買い上げ', 'ご注文確認', '配送', 'delivery',
      'shipped', '発送', '出荷', 'tracking', '追跡'
    ];

    const purchaseVendors = [
      'amazon', 'rakuten', 'yahoo', 'mercari', 'zozo', 'uniqlo',
      'apple', 'google', 'microsoft', 'adobe', 'shopify'
    ];

    const subjectLower = subject.toLowerCase();
    const fromLower = from.toLowerCase();

    // Check if it's actually a purchase email
    const hasPurchaseKeyword = purchaseKeywords.some(keyword =>
      subjectLower.includes(keyword) || fromLower.includes(keyword)
    );

    const isFromVendor = purchaseVendors.some(vendor =>
      fromLower.includes(vendor)
    );

    // Only mark as purchase if there's strong evidence
    const isPurchase = hasPurchaseKeyword && isFromVendor;

    // Generate dynamic labels based on content
    const generateLabels = (): string[] => {
      const labels: string[] = [];

      if (isPurchase) {
        labels.push('Purchase', 'Shopping');
        if (subjectLower.includes('shipped') || subjectLower.includes('発送')) {
          labels.push('Shipping');
        }
      } else if (subjectLower.includes('meeting') || subjectLower.includes('会議')) {
        labels.push('Meeting', 'Calendar');
      } else if (subjectLower.includes('project')) {
        labels.push('Project', 'Work');
      } else if (fromLower.includes('newsletter') || fromLower.includes('news')) {
        labels.push('Newsletter', 'Updates');
      }

      // Add vendor/sender as label if recognizable
      const vendor = from.split('@')[0]?.split('.')[0];
      if (vendor && vendor.length > 2) {
        labels.push(vendor.charAt(0).toUpperCase() + vendor.slice(1));
      }

      return labels.slice(0, 5); // Max 5 labels
    };

    return {
      emailType: isPurchase ? 'purchase' :
                random < 0.5 ? 'newsletter' :
                random < 0.7 ? 'personal' : 'notification',
      category: isPurchase ? 'Shopping' :
               random < 0.3 ? 'Business' :
               random < 0.6 ? 'Personal' : 'Marketing',
      priority: random < 0.1 ? 'high' : random < 0.5 ? 'medium' : 'low',
      labels: generateLabels(),
      customCategory: isPurchase ? 'Online Shopping' : undefined,

      purchase: isPurchase ? {
        isPurchase: true,
        confidence: 0.7 + random * 0.3,
        vendor: from.split('@')[0] || 'Unknown Vendor',
        amount: Math.floor(Math.random() * 50000) + 1000,
        currency: 'JPY',
        orderId: `ORD-${Date.now()}-${Math.floor(random * 1000)}`,
        items: [
          { name: 'Test Item', quantity: 1, price: Math.floor(Math.random() * 10000) }
        ]
      } : undefined,

      contacts: [{
        email: from,
        name: from.split('@')[0],
        relationship: 'service'
      }],

      discovery: {
        keyTopics: ['test', 'mock', 'demo'],
        sentiment: random < 0.3 ? 'positive' : random < 0.7 ? 'neutral' : 'negative',
        importance: Math.floor(random * 10) + 1
      },

      summary: `Mock analysis of: ${subject.substring(0, 50)}`,
      suggestedActions: random < 0.3 ? ['Review this email', 'Take action'] : undefined
    };
  }
}