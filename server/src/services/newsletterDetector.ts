export class NewsletterDetector {
  // 営業・マーケティングメール（メルマガ）のキーワード
  private static newsletterKeywords = [
    // 日本語マーケティング
    '配信停止', '配信解除', 'メルマガ', 'メールマガジン', 
    '購読解除', '登録解除', 'キャンペーン情報', 'お得な情報',
    'セール情報', '新商品', '期間限定', '会員限定',
    '特別価格', 'クーポン', '割引', 'ポイント',
    
    // 英語マーケティング
    'unsubscribe', 'newsletter', 'promotional', 'marketing',
    'special offer', 'exclusive deal', 'flash sale', 'discount',
    'limited time', 'save now', 'buy now', 'shop now',
    'new arrival', 'trending', 'hot deals'
  ];
  
  // サービス通知のキーワード
  private static serviceAnnouncementKeywords = [
    // 日本語サービス通知
    'アップデート', 'メンテナンス', '障害', '復旧',
    'パスワード', '認証', 'ログイン', 'アカウント',
    '請求書', '領収書', '支払い', '更新',
    'セキュリティ', '重要なお知らせ', 'サービス',
    
    // 英語サービス通知
    'update', 'maintenance', 'outage', 'recovery',
    'password', 'verification', 'login', 'account',
    'invoice', 'receipt', 'payment', 'renewal',
    'security', 'important notice', 'service',
    
    // 開発者向け通知
    'github', 'gitlab', 'pull request', 'merge',
    'commit', 'deployment', 'build', 'failed',
    'succeeded', 'notification', 'alert'
  ];

  // メルマガ送信者のドメインパターン
  private static newsletterDomains = [
    'mailchimp.com', 'sendgrid.net', 'amazonses.com', 
    'mailgun.org', 'campaign-', 'news.', 'newsletter.',
    'marketing.', 'email.', 'mail.', 'notify.', 'notification.'
  ];

  // メルマガとして除外するパターン（個人的なメールの可能性が高い）
  private static exclusionPatterns = [
    're:', 'RE:', 'Fwd:', 'FWD:', '返信:', '転送:',
    'meeting', 'appointment', 'invoice', 'receipt', 
    'password', 'verification', 'confirm your'
  ];

  /**
   * メールのタイプを判定（通常、メルマガ、サービス通知）
   */
  static detectEmailType(email: {
    subject?: string;
    from?: string;
    body?: string;
    snippet?: string;
  }): { 
    type: 'primary' | 'newsletter' | 'service_announcement'; 
    confidence: number; 
    reasons: string[] 
  } {
    let newsletterScore = 0;
    let serviceScore = 0;
    const reasons: string[] = [];
    
    const subject = (email.subject || '').toLowerCase();
    const from = (email.from || '').toLowerCase();
    const content = ((email.body || '') + ' ' + (email.snippet || '')).toLowerCase();

    // 個人メールのパターンチェック（返信や転送）
    for (const pattern of this.exclusionPatterns) {
      if (subject.includes(pattern.toLowerCase())) {
        return { type: 'primary', confidence: 100, reasons: ['Personal email pattern'] };
      }
    }

    // サービス通知のチェック
    for (const keyword of this.serviceAnnouncementKeywords) {
      if (subject.includes(keyword.toLowerCase()) || content.includes(keyword.toLowerCase())) {
        serviceScore += 25;
        reasons.push(`Service keyword: "${keyword}"`);
        if (serviceScore >= 50) break;
      }
    }

    // メルマガのチェック
    for (const keyword of this.newsletterKeywords) {
      if (subject.includes(keyword.toLowerCase()) || content.includes(keyword.toLowerCase())) {
        newsletterScore += 20;
        reasons.push(`Newsletter keyword: "${keyword}"`);
        if (newsletterScore >= 60) break;
      }
    }

    // ドメインチェック
    for (const domain of this.newsletterDomains) {
      if (from.includes(domain)) {
        newsletterScore += 30;
        reasons.push(`Marketing domain: "${domain}"`);
        break;
      }
    }

    // no-replyチェック
    if (from.includes('no-reply') || from.includes('noreply')) {
      // サービス通知の可能性も考慮
      if (serviceScore > 0) {
        serviceScore += 20;
      } else {
        newsletterScore += 20;
      }
      reasons.push('No-reply address');
    }

    // 配信停止リンクのチェック
    if (content.includes('unsubscribe') || content.includes('配信停止')) {
      newsletterScore += 30;
      reasons.push('Unsubscribe link');
    }

    // リンク数チェック（営業メールは多くのリンクを含む傾向）
    const linkCount = (content.match(/https?:\/\//g) || []).length;
    if (linkCount > 7) {
      newsletterScore += 20;
      reasons.push(`Many links (${linkCount})`);
    }

    // 判定
    if (serviceScore >= 50) {
      return { type: 'service_announcement', confidence: Math.min(serviceScore, 100), reasons };
    } else if (newsletterScore >= 50) {
      return { type: 'newsletter', confidence: Math.min(newsletterScore, 100), reasons };
    } else {
      return { type: 'primary', confidence: 100, reasons: ['Standard email'] };
    }
  }

  /**
   * メールのカテゴリーを推定
   */
  static categorizeNewsletter(email: {
    subject?: string;
    from?: string;
    body?: string;
  }): string {
    const content = ((email.subject || '') + ' ' + (email.from || '') + ' ' + (email.body || '')).toLowerCase();

    // カテゴリー判定
    if (content.includes('amazon') || content.includes('楽天') || 
        content.includes('shopping') || content.includes('order')) {
      return 'Shopping';
    }
    
    if (content.includes('news') || content.includes('ニュース') || 
        content.includes('daily') || content.includes('weekly')) {
      return 'News';
    }
    
    if (content.includes('tech') || content.includes('developer') || 
        content.includes('programming') || content.includes('github')) {
      return 'Tech';
    }
    
    if (content.includes('sale') || content.includes('discount') || 
        content.includes('offer') || content.includes('セール')) {
      return 'Promotions';
    }
    
    if (content.includes('social') || content.includes('facebook') || 
        content.includes('twitter') || content.includes('linkedin')) {
      return 'Social';
    }

    return 'General';
  }
}