import Anthropic from '@anthropic-ai/sdk';
import NodeCache from 'node-cache';

interface AnalysisResult {
  isPurchase: boolean;
  confidence: number;
  vendor?: string;
  amount?: number;
  currency?: string;
  orderId?: string;
  items?: Array<{ name: string; quantity: number; price: number }>;
}

export class AIPurchaseAnalyzer {
  private anthropic: Anthropic | null = null;
  private cache: NodeCache;
  private isInitialized = false;

  constructor() {
    // Cache results for 24 hours to avoid re-analyzing same emails
    this.cache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

    // Initialize Anthropic only if API key is available
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.isInitialized = true;
      console.log('✅ AI Purchase Analyzer initialized with Claude API');
    } else {
      console.log('⚠️ AI Purchase Analyzer not initialized (no ANTHROPIC_API_KEY)');
    }
  }

  async analyzeEmail(
    emailBody: string,
    subject: string,
    from: string,
    emailId: string
  ): Promise<AnalysisResult | null> {
    if (!this.isInitialized || !this.anthropic) {
      console.log('AI Purchase Analyzer not initialized (no API key)');
      return null;
    }

    // Check cache first
    const cacheKey = `purchase_${emailId}`;
    const cached = this.cache.get<AnalysisResult>(cacheKey);
    if (cached) {
      console.log(`Using cached AI analysis for email ${emailId}`);
      return cached;
    }

    try {
      // Truncate email body to save tokens (max 2000 chars)
      const truncatedBody = emailBody.substring(0, 2000);

      const prompt = `Analyze this email and determine if it's a purchase confirmation/receipt.
This is primarily Japanese e-commerce emails.

Email Subject: ${subject}
From: ${from}
Body: ${truncatedBody}

Analyze and return ONLY valid JSON (no other text, no markdown) with this structure:
{
  "isPurchase": boolean (true if this is a confirmed purchase/order/payment),
  "confidence": number (0-1, how confident you are),
  "vendor": string or null (merchant name if found - extract from email domain or content),
  "amount": number or null (total amount as number only, no currency symbols),
  "currency": string or null (JPY for ¥/円, USD for $, etc),
  "orderId": string or null (order/invoice number if found),
  "items": array or null (extracted items: [{name: string, quantity: number, price: number}])
}

IMPORTANT:
- Look for: 注文確認, 購入完了, 決済完了, ご注文, お買い上げ, 領収書, 請求書
- Also look for: order confirmation, payment received, invoice, receipt
- Extract amount from: 合計, 総額, total, 支払い金額, ご請求金額
- If you see ¥ or 円, currency is "JPY"
- Return isPurchase: true ONLY for actual completed purchases
- Exclude: newsletters, promotions, marketing, cart reminders, wish lists

Respond with JSON only.`;

      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307', // Using Haiku for cost efficiency
        max_tokens: 500,
        temperature: 0.1, // Low temperature for consistent results
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      // Extract JSON from Claude's response
      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      // Try to parse JSON from the response
      let jsonStr = content.text;
      // Remove any markdown code blocks if present
      jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');

      const result = JSON.parse(jsonStr) as AnalysisResult;

      // Cache the result
      this.cache.set(cacheKey, result);

      console.log(`AI analysis for email ${emailId}:`, {
        isPurchase: result.isPurchase,
        confidence: result.confidence,
        vendor: result.vendor
      });

      return result;
    } catch (error) {
      console.error('AI analysis error:', error);
      return null;
    }
  }

  // Batch analyze multiple emails efficiently
  async batchAnalyze(
    emails: Array<{
      body: string;
      subject: string;
      from: string;
      emailId: string;
    }>
  ): Promise<Map<string, AnalysisResult>> {
    const results = new Map<string, AnalysisResult>();

    // Process in batches of 5 to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      const promises = batch.map(email =>
        this.analyzeEmail(email.body, email.subject, email.from, email.emailId)
      );

      const batchResults = await Promise.all(promises);

      batchResults.forEach((result, index) => {
        if (result) {
          results.set(batch[index].emailId, result);
        }
      });

      // Small delay between batches to respect rate limits
      if (i + batchSize < emails.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  // Get analysis statistics
  getStats(): {
    cacheSize: number;
    cacheHits: number;
    isEnabled: boolean;
  } {
    return {
      cacheSize: this.cache.keys().length,
      cacheHits: this.cache.getStats().hits,
      isEnabled: this.isInitialized
    };
  }

  // Clear cache
  clearCache(): void {
    this.cache.flushAll();
    console.log('AI analysis cache cleared');
  }
}