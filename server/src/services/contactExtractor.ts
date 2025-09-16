interface ContactInfo {
  name?: string;
  email: string;
  company?: string;
  department?: string;
  phone?: string;
  address?: string;
  title?: string;
  website?: string;
  socialMedia?: {
    linkedin?: string;
    twitter?: string;
    github?: string;
  };
  meetingContext?: string;
  projectInfo?: string;
}

export class ContactExtractor {
  private phonePatterns = [
    /(?:tel|phone|電話)[\s:：]*([0-9\-\(\)\s+]+)/gi,
    /\b(\d{2,4}[-.\s]?\d{2,4}[-.\s]?\d{3,4})\b/g,
    /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,4}/g
  ];

  private emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

  private companyPatterns = [
    /(?:company|会社|株式会社|有限会社)[\s:：]*([^\n\r,]+)/gi,
    /^([株有]式会社.+)$/gm,
    /(.+[株有]式会社)$/gm
  ];

  private departmentPatterns = [
    /(?:department|dept|部署|部)[\s:：]*([^\n\r,]+)/gi,
    /(.+[部課室])\s*$/gm
  ];

  private titlePatterns = [
    /(?:title|役職|肩書)[\s:：]*([^\n\r,]+)/gi,
    /(CEO|CTO|CFO|Manager|Director|マネージャー|部長|課長|係長|主任)/gi
  ];

  extractFromEmail(emailBody: string, senderEmail: string, subject?: string): ContactInfo {
    const signature = this.extractSignature(emailBody);

    const contact: ContactInfo = {
      email: senderEmail
    };

    contact.name = this.extractName(signature, senderEmail) || this.extractNameFromBody(emailBody);
    contact.phone = this.extractPhone(signature) || this.extractPhone(emailBody);
    contact.company = this.extractCompany(signature) || this.extractCompany(emailBody);
    contact.department = this.extractDepartment(signature) || this.extractDepartment(emailBody);
    contact.title = this.extractTitle(signature) || this.extractTitle(emailBody);
    contact.address = this.extractAddress(signature) || this.extractAddress(emailBody);
    contact.website = this.extractWebsite(emailBody);
    contact.socialMedia = this.extractSocialMedia(emailBody);
    contact.meetingContext = this.extractMeetingContext(emailBody, subject);
    contact.projectInfo = this.extractProjectInfo(emailBody, subject);

    return this.cleanupContact(contact);
  }

  extractFromSignature(emailBody: string, senderEmail: string): ContactInfo {
    return this.extractFromEmail(emailBody, senderEmail);
  }

  private extractSignature(emailBody: string): string {
    const signatureMarkers = [
      /^--\s*$/m,
      /^regards,?$/im,
      /^best regards,?$/im,
      /^sincerely,?$/im,
      /^thanks,?$/im,
      /^thank you,?$/im,
      /^cheers,?$/im,
      /^よろしくお願いします/m,
      /^以上/m
    ];

    let signatureStart = emailBody.length;

    for (const marker of signatureMarkers) {
      const match = emailBody.match(marker);
      if (match && match.index !== undefined && match.index < signatureStart) {
        signatureStart = match.index;
      }
    }

    const lines = emailBody.split('\n');
    const lastLines = lines.slice(-10);

    if (signatureStart === emailBody.length) {
      const hasContactInfo = lastLines.some(line =>
        this.phonePatterns.some(p => p.test(line)) ||
        this.emailPattern.test(line) ||
        this.companyPatterns.some(p => p.test(line))
      );

      if (hasContactInfo) {
        return lastLines.join('\n');
      }
    }

    return emailBody.substring(signatureStart);
  }

  private extractName(signature: string, email: string): string | undefined {
    const nameFromEmail = email.split('@')[0]
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());

    const lines = signature.split('\n').filter(l => l.trim());

    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      if (firstLine.length < 50 && !this.emailPattern.test(firstLine) &&
          !this.phonePatterns.some(p => p.test(firstLine))) {
        return firstLine;
      }
    }

    return nameFromEmail;
  }

  private extractPhone(signature: string): string | undefined {
    for (const pattern of this.phonePatterns) {
      const match = signature.match(pattern);
      if (match) {
        return match[1] || match[0];
      }
    }
    return undefined;
  }

  private extractCompany(signature: string): string | undefined {
    for (const pattern of this.companyPatterns) {
      const match = signature.match(pattern);
      if (match) {
        return match[1]?.trim();
      }
    }
    return undefined;
  }

  private extractDepartment(signature: string): string | undefined {
    for (const pattern of this.departmentPatterns) {
      const match = signature.match(pattern);
      if (match) {
        return match[1]?.trim();
      }
    }
    return undefined;
  }

  private extractTitle(signature: string): string | undefined {
    for (const pattern of this.titlePatterns) {
      const match = signature.match(pattern);
      if (match) {
        return match[1]?.trim() || match[0]?.trim();
      }
    }
    return undefined;
  }

  private extractAddress(signature: string): string | undefined {
    const addressPatterns = [
      /(?:address|住所|所在地)[\s:：]*([^\n\r]+(?:\n[^\n\r]+)?)/gi,
      /〒?\d{3}-?\d{4}[\s\S]+?(?:[都道府県市区町村]|[0-9-]+)/g
    ];

    for (const pattern of addressPatterns) {
      const match = signature.match(pattern);
      if (match) {
        return match[1]?.trim() || match[0]?.trim();
      }
    }
    return undefined;
  }

  private extractNameFromBody(emailBody: string): string | undefined {
    const namePatterns = [
      /(?:私は|僕は|I am|My name is|This is)\s+([A-Za-z\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+(?:\s+[A-Za-z\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+)?)/gi,
      /(?:こんにちは、|Hello,|Hi,|Dear [^,]+,)\s*([A-Za-z\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+(?:\s+[A-Za-z\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+)?)/gi
    ];

    for (const pattern of namePatterns) {
      const match = emailBody.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return undefined;
  }

  private extractWebsite(emailBody: string): string | undefined {
    const websitePattern = /https?:\/\/(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)(?:\/[^\s]*)?/g;
    const matches = emailBody.matchAll(websitePattern);

    for (const match of matches) {
      const domain = match[1];
      if (!domain.includes('gmail.com') && !domain.includes('outlook.com') &&
          !domain.includes('yahoo.com') && !domain.includes('linkedin.com') &&
          !domain.includes('twitter.com') && !domain.includes('facebook.com')) {
        return match[0];
      }
    }
    return undefined;
  }

  private extractSocialMedia(emailBody: string): ContactInfo['socialMedia'] | undefined {
    const socialMedia: ContactInfo['socialMedia'] = {};

    const linkedinPattern = /linkedin\.com\/in\/([a-zA-Z0-9-]+)/gi;
    const twitterPattern = /twitter\.com\/([a-zA-Z0-9_]+)/gi;
    const githubPattern = /github\.com\/([a-zA-Z0-9-]+)/gi;

    const linkedinMatch = emailBody.match(linkedinPattern);
    if (linkedinMatch) {
      socialMedia.linkedin = linkedinMatch[0];
    }

    const twitterMatch = emailBody.match(twitterPattern);
    if (twitterMatch) {
      socialMedia.twitter = twitterMatch[0];
    }

    const githubMatch = emailBody.match(githubPattern);
    if (githubMatch) {
      socialMedia.github = githubMatch[0];
    }

    return Object.keys(socialMedia).length > 0 ? socialMedia : undefined;
  }

  private extractMeetingContext(emailBody: string, subject?: string): string | undefined {
    const meetingPatterns = [
      /(?:meeting|会議|打ち合わせ|ミーティング)(?:について|regarding|about|on)\s*[:：]?\s*([^\n\r.!?]+)/gi,
      /(?:discuss|話し合い|相談)(?:について|regarding|about)\s*[:：]?\s*([^\n\r.!?]+)/gi,
      /(?:プロジェクト|project|案件)(?:について|regarding|about|:)\s*([^\n\r.!?]+)/gi
    ];

    const fullText = (subject ? subject + '\n' : '') + emailBody;

    for (const pattern of meetingPatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        return match[1].trim().substring(0, 200);
      }
    }

    if (subject && (subject.includes('meeting') || subject.includes('会議') ||
                    subject.includes('打ち合わせ') || subject.includes('MTG'))) {
      return subject;
    }

    return undefined;
  }

  private extractProjectInfo(emailBody: string, subject?: string): string | undefined {
    const projectPatterns = [
      /(?:project|プロジェクト|案件|開発)(?:名|name|:)\s*[:：]?\s*([^\n\r.!?]+)/gi,
      /(?:working on|取り組んでいる|開発中の)\s*[:：]?\s*([^\n\r.!?]+)/gi,
      /(?:予算|budget|規模|scale)\s*[:：]?\s*([^\n\r.!?]+)/gi
    ];

    const fullText = (subject ? subject + '\n' : '') + emailBody;

    for (const pattern of projectPatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        return match[1].trim().substring(0, 200);
      }
    }

    return undefined;
  }

  private cleanupContact(contact: ContactInfo): ContactInfo {
    const cleaned: ContactInfo = { email: contact.email };

    if (contact.name && contact.name.length < 100) {
      cleaned.name = contact.name.trim();
    }

    if (contact.phone) {
      cleaned.phone = contact.phone.replace(/\s+/g, ' ').trim();
    }

    if (contact.company) {
      cleaned.company = contact.company.trim();
    }

    if (contact.department) {
      cleaned.department = contact.department.trim();
    }

    if (contact.title) {
      cleaned.title = contact.title.trim();
    }

    if (contact.address) {
      cleaned.address = contact.address.replace(/\s+/g, ' ').trim();
    }

    if (contact.website) {
      cleaned.website = contact.website.trim();
    }

    if (contact.socialMedia) {
      cleaned.socialMedia = contact.socialMedia;
    }

    if (contact.meetingContext) {
      cleaned.meetingContext = contact.meetingContext.trim();
    }

    if (contact.projectInfo) {
      cleaned.projectInfo = contact.projectInfo.trim();
    }

    return cleaned;
  }
}