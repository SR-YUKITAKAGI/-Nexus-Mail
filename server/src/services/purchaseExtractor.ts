import { UnifiedEmailAnalyzer } from './unifiedEmailAnalyzer';

interface Purchase {
  id: string;
  orderId?: string;
  vendor: string;
  amount: number;
  currency: string;
  date: Date;
  items: PurchaseItem[];
  status?: string;
  trackingNumber?: string;
  category?: string;
  paymentMethod?: string;
  emailId: string;
  confidence?: number;
  aiAnalyzed?: boolean;
  deliveryDate?: string;
}

interface PurchaseItem {
  name: string;
  quantity: number;
  price: number;
  description?: string;
}

interface ExtractionResult {
  purchase: Purchase | null;
  confidence: number;
  needsAIAnalysis: boolean;
}

export class PurchaseExtractor {
  private unifiedAnalyzer: UnifiedEmailAnalyzer;
  constructor() {
    this.unifiedAnalyzer = new UnifiedEmailAnalyzer();
  }

  private vendorPatterns = [
    { vendor: 'Amazon', patterns: [/amazon\.co/i, /アマゾン/] },
    { vendor: 'Rakuten', patterns: [/rakuten/i, /楽天/] },
    { vendor: 'Yahoo Shopping', patterns: [/yahoo/i, /ヤフー/] },
    { vendor: 'Mercari', patterns: [/mercari/i, /メルカリ/] },
    { vendor: 'Apple', patterns: [/apple\.com/i, /itunes/i, /app\s*store/i] },
    { vendor: 'Google', patterns: [/google\s*play/i, /google\s*store/i, /google\s*cloud/i] },
    { vendor: 'Microsoft', patterns: [/microsoft/i, /office\s*365/i, /azure/i] },
    { vendor: 'Adobe', patterns: [/adobe/i, /creative\s*cloud/i] },
    { vendor: 'Uber', patterns: [/uber/i] },
    { vendor: 'Uber Eats', patterns: [/ubereats/i, /uber\s*eats/i] },
    { vendor: 'Netflix', patterns: [/netflix/i] },
    { vendor: 'Spotify', patterns: [/spotify/i] },
    { vendor: 'Steam', patterns: [/steam/i, /valve/i] },
    { vendor: 'PayPay', patterns: [/paypay/i] },
    { vendor: 'LINE Pay', patterns: [/line\s*pay/i] },
    { vendor: 'Stripe', patterns: [/stripe/i] },
    { vendor: 'PayPal', patterns: [/paypal/i] },
    { vendor: 'Shopify', patterns: [/shopify/i] },
    { vendor: 'ZOZO', patterns: [/zozo/i, /zozotown/i] },
    { vendor: 'UNIQLO', patterns: [/uniqlo/i, /ユニクロ/] },
    { vendor: 'GU', patterns: [/\bgu\b/i, /ジーユー/] },
    { vendor: 'Muji', patterns: [/muji/i, /無印良品/] },
    { vendor: 'Yodobashi', patterns: [/yodobashi/i, /ヨドバシ/] },
    { vendor: 'Bic Camera', patterns: [/biccamera/i, /ビックカメラ/] },
  ];

  private currencySymbols: { [key: string]: string } = {
    '$': 'USD',
    '¥': 'JPY',
    '€': 'EUR',
    '£': 'GBP',
    '円': 'JPY',
  };

  async extractPurchase(emailBody: string, subject: string, from: string, emailId: string, timestamp?: string): Promise<Purchase | null> {
    // Use unified analyzer for comprehensive analysis
    console.log(`Analyzing email ${emailId} with unified AI analyzer...`);
    const analysis = await this.unifiedAnalyzer.analyzeEmail(emailBody, subject, from, emailId);

    if (analysis && analysis.purchase) {
      const purchaseData = analysis.purchase;

      // Check if it's actually a purchase with sufficient confidence
      if (purchaseData.isPurchase && purchaseData.confidence >= 0.3) {
        // Use AI results as primary source, fallback to regex extraction for missing fields
        const vendor = purchaseData.vendor || this.detectVendor(from, subject, emailBody);
        const amount = purchaseData.amount || this.extractAmount(emailBody);

        if (!vendor || !amount || amount === 0) {
          console.log(`Skipping email ${emailId}: missing vendor or amount`);
          return null;
        }

        const items = purchaseData.items || this.extractItems(emailBody);

        console.log(`✅ Purchase detected: ${vendor} - ¥${amount} (confidence: ${purchaseData.confidence})`);
        console.log(`   Category: ${analysis.category}, Priority: ${analysis.priority}`);
        if (analysis.discovery) {
          console.log(`   Topics: ${analysis.discovery.keyTopics.join(', ')}`);
        }

        return {
          id: `${emailId}_${Date.now()}`,
          orderId: purchaseData.orderId || this.extractOrderId(emailBody, subject),
          vendor,
          amount,
          currency: purchaseData.currency || this.extractCurrency(emailBody) || 'JPY',
          date: timestamp ? new Date(timestamp) : new Date(),
          items,
          status: this.extractOrderStatus(emailBody) || 'Confirmed',
          trackingNumber: purchaseData.trackingNumber || this.extractTrackingNumber(emailBody),
          deliveryDate: purchaseData.deliveryDate,
          category: this.categorizePurchase(vendor, items),
          paymentMethod: this.extractPaymentMethod(emailBody),
          emailId,
          confidence: purchaseData.confidence,
          aiAnalyzed: true
        };
      } else {
        console.log(`❌ Not a purchase according to AI: ${emailId} (confidence: ${purchaseData.confidence})`);
      }
    } else {
      console.log(`⚠️ No purchase data in analysis for ${emailId}, falling back to regex`);
      // Fallback to regex-based extraction if AI is not available
      const regexResult = this.extractWithConfidence(emailBody, subject, from, emailId, timestamp);
      if (regexResult.confidence >= 0.5 && regexResult.purchase) {
        return { ...regexResult.purchase, confidence: regexResult.confidence };
      }
    }

    return null;
  }

  private extractWithConfidence(emailBody: string, subject: string, from: string, emailId: string, timestamp?: string): ExtractionResult {
    let confidence = 0;
    let needsAIAnalysis = false;

    // Check if it matches purchase patterns
    const purchaseScore = this.calculatePurchaseScore(emailBody, subject, from);
    confidence = purchaseScore;

    // If score is in uncertain range, flag for AI analysis
    if (confidence > 0.3 && confidence < 0.8) {
      needsAIAnalysis = true;
    }

    // Skip obvious non-purchases
    if (confidence < 0.2) {
      return { purchase: null, confidence, needsAIAnalysis: false };
    }

    const vendor = this.detectVendor(from, subject, emailBody);
    if (!vendor) {
      confidence *= 0.5; // Reduce confidence if no vendor detected
      needsAIAnalysis = true;
    }

    const orderId = this.extractOrderId(emailBody, subject);
    const amount = this.extractAmount(emailBody);
    const currency = this.extractCurrency(emailBody);
    const items = this.extractItems(emailBody);
    const status = this.extractOrderStatus(emailBody);
    const trackingNumber = this.extractTrackingNumber(emailBody);
    const category = this.categorizePurchase(vendor || 'Unknown', items);
    const paymentMethod = this.extractPaymentMethod(emailBody);

    // Validate amount
    if (!amount || amount === 0 || amount > 10000000) {
      return { purchase: null, confidence: 0, needsAIAnalysis };
    }

    // Boost confidence if we have order ID and tracking
    if (orderId) confidence = Math.min(1, confidence * 1.2);
    if (trackingNumber) confidence = Math.min(1, confidence * 1.1);

    const purchase: Purchase = {
      id: `${emailId}_${Date.now()}`,
      orderId,
      vendor: vendor || 'Unknown',
      amount,
      currency: currency || 'USD',
      date: timestamp ? new Date(timestamp) : new Date(),
      items,
      status,
      trackingNumber,
      category,
      paymentMethod,
      emailId,
      confidence
    };

    return { purchase, confidence, needsAIAnalysis };
  }

  private calculatePurchaseScore(body: string, subject: string, from: string): number {
    const fullText = `${subject} ${body}`.toLowerCase();
    let score = 0;

    // Strong positive signals (purchase confirmations)
    const strongPositivePatterns = [
      /order\s+(?:confirmed|complete|successful|received|placed)/i,
      /purchase\s+(?:complete|successful|confirmed)/i,
      /payment\s+(?:received|successful|complete|confirmed|processed)/i,
      /transaction\s+(?:complete|successful|approved)/i,
      /your\s+order\s+has\s+been\s+(?:confirmed|placed|received)/i,
      /successfully\s+(?:purchased|ordered|paid)/i,
      /order\s+#\d+/i,
      /invoice\s+#\d+/i,
      /注文(?:が)?(?:確定|完了|確認)/,
      /購入(?:が)?(?:完了|確定)/,
      /決済(?:が)?(?:完了|成功|確定)/,
      /ご購入ありがとうございます/,
      /お買い上げ(?:ありがとう|いただき)/,
      /ご注文(?:を)?(?:承り|確認|受付)/,
    ];

    // Medium positive signals
    const mediumPositivePatterns = [
      /receipt/i,
      /invoice/i,
      /your\s+order/i,
      /thank\s+you\s+for\s+your/i,
      /領収書/,
      /請求書/,
      /ご注文/,
    ];

    // Negative signals (marketing)
    const negativePatterns = [
      /sale\s+ends\s+soon/i,
      /limited\s+time\s+offer/i,
      /act\s+now/i,
      /click\s+here\s+to\s+save/i,
      /メルマガ/,
      /キャンペーン/,
      /セール中/,
      /newsletter/i,
      /unsubscribe/i,
      /special\s+offer/i,
      /discount\s+code/i,
      /coupon/i,
      /deal\s+of\s+the\s+day/i,
      /flash\s+sale/i,
      /今なら/,
      /期間限定/,
      /お得な情報/,
      /新商品のご案内/,
      /おすすめ商品/,
      /カートに追加/,
      /add\s+to\s+cart/i,
      /view\s+in\s+browser/i,
      /クリックして/,
    ];

    // Count pattern matches
    let strongMatches = 0;
    let mediumMatches = 0;
    let negativeMatches = 0;

    strongPositivePatterns.forEach(pattern => {
      if (pattern.test(fullText)) strongMatches++;
    });

    mediumPositivePatterns.forEach(pattern => {
      if (pattern.test(fullText)) mediumMatches++;
    });

    negativePatterns.forEach(pattern => {
      if (pattern.test(fullText)) negativeMatches++;
    });

    // Calculate score with adjusted weights
    score = (strongMatches * 0.5) + (mediumMatches * 0.2) - (negativeMatches * 0.4);

    // If strong purchase signals exist, ensure minimum score
    if (strongMatches > 0) {
      score = Math.max(score, 0.4);
    }

    // If too many negative signals, cap the score
    if (negativeMatches >= 3) {
      score = Math.min(score, 0.3);
    }

    // Normalize to 0-1 range
    score = Math.max(0, Math.min(1, score));

    return score;
  }

  private isPurchaseEmail(body: string, subject: string, from: string): boolean {
    const fullText = `${subject} ${body}`.toLowerCase();

    // Exclude marketing/promotional emails
    const marketingPatterns = [
      /sale\s+ends\s+soon/i,
      /limited\s+time\s+offer/i,
      /act\s+now/i,
      /click\s+here\s+to\s+save/i,
      /メルマガ/,
      /キャンペーン/,
      /セール中/,
      /今なら/,
      /期間限定/,
      /newsletter/i,
      /unsubscribe/i,
      /promotional/i,
    ];

    const isMarketing = marketingPatterns.some(pattern => pattern.test(fullText));
    if (isMarketing) {
      // Even if it contains marketing keywords, check if it's still a purchase confirmation
      const strongPurchasePattern = /(?:購入完了|注文確定|決済完了|payment\s+successful|order\s+confirmed)/i;
      if (!strongPurchasePattern.test(fullText)) {
        return false;
      }
    }

    // Must contain STRONG purchase completion keywords
    const confirmationPatterns = [
      // English patterns - completed transactions
      /order\s+(?:confirmed|complete|successful|received|placed)/i,
      /purchase\s+(?:complete|successful|confirmed)/i,
      /payment\s+(?:received|successful|complete|confirmed|processed)/i,
      /transaction\s+(?:complete|successful|approved)/i,
      /your\s+order\s+(?:has\s+been|is)\s+confirmed/i,
      /thank\s+you\s+for\s+your\s+(?:order|purchase|payment)/i,
      /receipt\s+(?:for|from)/i,
      /invoice\s+(?:#|number|for)/i,
      /charged\s+(?:to|your)/i,
      /we\s+(?:have|'ve)\s+received\s+your\s+(?:order|payment)/i,

      // Japanese patterns - completed transactions
      /注文(?:が)?(?:確定|完了|確認)/,
      /ご注文(?:を)?(?:承り|受付|確認)/,
      /購入(?:が)?(?:完了|確定)/,
      /決済(?:が)?(?:完了|成功|確定)/,
      /お支払い(?:が)?(?:完了|確認)/,
      /ご購入(?:ありがとう|いただき)/,
      /お買い上げ(?:ありがとう|いただき)/,
      /請求(?:書|内容|金額)/,
      /領収書/,
      /ご利用明細/,
      /発送(?:完了|しました|のお知らせ)/,
      /配送(?:完了|しました|のお知らせ)/,
    ];

    return confirmationPatterns.some(pattern => pattern.test(fullText));
  }

  private detectVendor(from: string, subject: string, body: string): string | null {
    const fullText = `${from} ${subject} ${body}`.toLowerCase();

    for (const vendorInfo of this.vendorPatterns) {
      for (const pattern of vendorInfo.patterns) {
        if (pattern.test(fullText)) {
          return vendorInfo.vendor;
        }
      }
    }

    // Extract vendor from email domain only if it's a known commerce domain
    const commerceDomains = [
      'amazon', 'rakuten', 'yahoo', 'mercari', 'apple', 'google',
      'microsoft', 'adobe', 'stripe', 'paypal', 'shopify', 'steam',
      'netflix', 'spotify', 'uber', 'ubereats', 'paypay', 'line',
      'zozo', 'zozotown', 'uniqlo', 'gu-global', 'muji', 'yodobashi',
      'biccamera', 'sofmap', 'kojima', 'edion', 'yamada', 'nojima',
      'bookoff', 'tsutaya', 'tower', 'hmv', 'animate', 'toranoana',
      'melonbooks', 'dmm', 'dlsite', 'booth', 'suzuri', 'base',
      'stores', 'minne', 'creema', 'qoo10', 'buyma', 'farfetch',
      'ssense', 'endclothing', 'mrporter', 'netaporter', 'matchesfashion'
    ];

    const domainMatch = from.match(/@([^.]+)/);
    if (domainMatch && commerceDomains.includes(domainMatch[1].toLowerCase())) {
      return domainMatch[1].charAt(0).toUpperCase() + domainMatch[1].slice(1);
    }

    return null;
  }

  private extractOrderId(body: string, subject: string): string | undefined {
    const patterns = [
      /order\s*#?\s*:?\s*([A-Z0-9-]+)/i,
      /注文番号\s*:?\s*([A-Z0-9-]+)/,
      /confirmation\s*#?\s*:?\s*([A-Z0-9-]+)/i,
      /invoice\s*#?\s*:?\s*([A-Z0-9-]+)/i,
    ];

    const fullText = `${subject}\n${body}`;
    for (const pattern of patterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return undefined;
  }

  private extractAmount(body: string): number {
    // More specific patterns for actual purchase amounts
    const patterns = [
      /(?:total|合計|総額)[:\s]*(?:\$|¥|￥|円)?([0-9,]+(?:\.\d{2})?)/i,
      /(?:amount\s+paid|支払い金額|お支払い金額)[:\s]*(?:\$|¥|￥|円)?([0-9,]+(?:\.\d{2})?)/i,
      /(?:grand\s*total|総合計|合計金額)[:\s]*(?:\$|¥|￥|円)?([0-9,]+(?:\.\d{2})?)/i,
      /(?:payment\s+amount|決済金額|ご利用金額)[:\s]*(?:\$|¥|￥|円)?([0-9,]+(?:\.\d{2})?)/i,
      /(?:charged|請求金額|ご請求)[:\s]*(?:\$|¥|￥|円)?([0-9,]+(?:\.\d{2})?)/i,
      /(?:you\s+paid|お支払い|支払額)[:\s]*(?:\$|¥|￥|円)?([0-9,]+(?:\.\d{2})?)/i,
      /(?:\$|¥|￥)([0-9,]+(?:\.\d{2})?)\s*(?:円|yen|jpy)?/i,
      /([0-9,]+)\s*円/,
    ];

    let amounts: number[] = [];
    for (const pattern of patterns) {
      const matches = body.matchAll(new RegExp(pattern, 'g'));
      for (const match of matches) {
        if (match[1]) {
          const amount = parseFloat(match[1].replace(/,/g, ''));
          // Reasonable amount range for purchases
          if (amount > 0 && amount < 1000000) {
            amounts.push(amount);
          }
        }
      }
    }

    // Return the largest amount found (usually the total)
    return amounts.length > 0 ? Math.max(...amounts) : 0;
  }

  private extractCurrency(body: string): string {
    for (const [symbol, code] of Object.entries(this.currencySymbols)) {
      if (body.includes(symbol)) {
        return code;
      }
    }

    // Check for currency codes
    const currencyCodes = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];
    for (const code of currencyCodes) {
      if (body.includes(code)) {
        return code;
      }
    }

    return 'USD';
  }

  private extractItems(body: string): PurchaseItem[] {
    const items: PurchaseItem[] = [];

    // Try to extract item lines
    const itemPatterns = [
      /^(.+?)\s+x(\d+)\s+\$?([0-9,]+\.?\d*)/gm,
      /^(.+?)\s+(\d+)\s*個\s+[¥￥]?([0-9,]+)/gm,
      /^-\s*(.+?)\s+\((\d+)\)\s+\$?([0-9,]+\.?\d*)/gm,
    ];

    for (const pattern of itemPatterns) {
      const matches = body.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[2] && match[3]) {
          items.push({
            name: match[1].trim(),
            quantity: parseInt(match[2]),
            price: parseFloat(match[3].replace(/,/g, ''))
          });
        }
      }
    }

    // If no items found, try to extract product names
    if (items.length === 0) {
      const productPatterns = [
        /product:\s*(.+)/i,
        /item:\s*(.+)/i,
        /商品名:\s*(.+)/,
      ];

      for (const pattern of productPatterns) {
        const match = body.match(pattern);
        if (match && match[1]) {
          items.push({
            name: match[1].trim(),
            quantity: 1,
            price: 0
          });
          break;
        }
      }
    }

    return items;
  }

  private extractOrderStatus(body: string): string | undefined {
    const statusPatterns = [
      { pattern: /shipped/i, status: 'Shipped' },
      { pattern: /delivered/i, status: 'Delivered' },
      { pattern: /processing/i, status: 'Processing' },
      { pattern: /confirmed/i, status: 'Confirmed' },
      { pattern: /発送/i, status: 'Shipped' },
      { pattern: /配達完了/i, status: 'Delivered' },
      { pattern: /処理中/i, status: 'Processing' },
    ];

    for (const { pattern, status } of statusPatterns) {
      if (pattern.test(body)) {
        return status;
      }
    }

    return 'Confirmed';
  }

  private extractTrackingNumber(body: string): string | undefined {
    const patterns = [
      /tracking\s*#?\s*:?\s*([A-Z0-9]+)/i,
      /追跡番号\s*:?\s*([A-Z0-9]+)/,
      /track\s*your\s*package\s*:?\s*([A-Z0-9]+)/i,
    ];

    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match && match[1] && match[1].length > 8) {
        return match[1];
      }
    }

    return undefined;
  }

  private categorizePurchase(vendor: string, items: PurchaseItem[]): string {
    // Categorize based on vendor
    const vendorCategories: { [key: string]: string } = {
      'Amazon': 'Shopping',
      'Rakuten': 'Shopping',
      'Apple': 'Digital Services',
      'Google': 'Digital Services',
      'Uber': 'Transportation',
      'Netflix': 'Entertainment',
      'Spotify': 'Entertainment',
    };

    if (vendorCategories[vendor]) {
      return vendorCategories[vendor];
    }

    // Try to categorize based on items
    const itemText = items.map(i => i.name).join(' ').toLowerCase();

    if (itemText.includes('food') || itemText.includes('restaurant') || itemText.includes('食')) {
      return 'Food & Dining';
    }
    if (itemText.includes('book') || itemText.includes('本')) {
      return 'Books & Education';
    }
    if (itemText.includes('software') || itemText.includes('app')) {
      return 'Software';
    }
    if (itemText.includes('hotel') || itemText.includes('flight')) {
      return 'Travel';
    }

    return 'Other';
  }

  private extractPaymentMethod(body: string): string | undefined {
    const patterns = [
      /payment\s*method\s*:?\s*(.+)/i,
      /paid\s*with\s*:?\s*(.+)/i,
      /card\s*ending\s*in\s*(\d{4})/i,
      /支払い方法\s*:?\s*(.+)/,
    ];

    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match && match[1]) {
        const method = match[1].trim();
        // Clean up and standardize
        if (method.match(/\d{4}$/)) {
          return `Card ending in ${method.match(/\d{4}$/)?.[0]}`;
        }
        return method.substring(0, 50);
      }
    }

    return undefined;
  }
}