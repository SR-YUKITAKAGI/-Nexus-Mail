import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as iconv from 'iconv-lite';

export class GmailService {
  private oauth2Client: OAuth2Client;
  public gmail: any;

  constructor(accessToken: string, refreshToken: string) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  async getThreads(query?: string, maxResults: number = 20) {
    try {
      const response = await this.gmail.users.threads.list({
        userId: 'me',
        q: query || 'in:inbox',
        maxResults,
      });

      const threads = response.data.threads || [];
      
      // Get full thread details
      const threadDetails = await Promise.all(
        threads.map(async (thread: any) => {
          return await this.getThread(thread.id);
        })
      );

      return threadDetails;
    } catch (error) {
      console.error('Error fetching threads:', error);
      throw error;
    }
  }

  async getThread(threadId: string) {
    try {
      const response = await this.gmail.users.threads.get({
        userId: 'me',
        id: threadId,
      });

      const thread = response.data;
      const messages = thread.messages || [];
      
      // Parse thread data
      const parsedThread = {
        id: thread.id,
        messages: messages.map((msg: any) => this.parseMessage(msg)),
        snippet: thread.snippet,
      };

      // Extract thread metadata from the first message
      const firstMessage = parsedThread.messages[0];
      if (firstMessage) {
        return {
          ...parsedThread,
          subject: firstMessage.subject,
          participants: this.extractParticipants(parsedThread.messages),
          lastMessage: parsedThread.messages[parsedThread.messages.length - 1].snippet,
          timestamp: parsedThread.messages[parsedThread.messages.length - 1].date,
          unreadCount: parsedThread.messages.filter((m: any) => m.labelIds?.includes('UNREAD')).length,
          hasAttachment: parsedThread.messages.some((m: any) => m.hasAttachment),
        };
      }

      return parsedThread;
    } catch (error) {
      console.error('Error fetching thread:', error);
      throw error;
    }
  }

  // Decode MIME encoded headers (RFC 2047)
  private decodeMimeHeader(header: string): string {
    if (!header) return '';

    // Handle =?charset?encoding?data?= format
    return header.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (match, charset, encoding, data) => {
      try {
        let decoded: string;

        // Decode based on encoding type
        if (encoding.toUpperCase() === 'B') {
          // Base64 encoding
          const buffer = Buffer.from(data, 'base64');
          decoded = this.decodeWithCharset(buffer, charset);
        } else if (encoding.toUpperCase() === 'Q') {
          // Quoted-printable encoding
          // Replace _ with space and decode hex sequences
          const qpDecoded = data
            .replace(/_/g, ' ')
            .replace(/=([0-9A-F]{2})/gi, (m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
          const buffer = Buffer.from(qpDecoded, 'latin1');
          decoded = this.decodeWithCharset(buffer, charset);
        } else {
          decoded = data;
        }

        return decoded;
      } catch (error) {
        console.error('MIME header decode error:', error);
        return match; // Return original if decode fails
      }
    });
  }

  // Decode buffer with specific charset
  private decodeWithCharset(buffer: Buffer, charset: string): string {
    try {
      const normalizedCharset = charset.toLowerCase().replace(/[_-]/g, '');

      // Map common charset names
      const charsetMap: Record<string, string> = {
        'utf8': 'utf8',
        'utf16le': 'utf16le',
        'utf16be': 'utf16be',
        'iso88591': 'latin1',
        'iso88592': 'iso88592',
        'iso88595': 'iso88595',
        'iso88597': 'iso88597',
        'iso88598': 'iso88598',
        'iso88599': 'latin5',
        'iso885915': 'iso885915',
        'windows1250': 'win1250',
        'windows1251': 'win1251',
        'windows1252': 'win1252',
        'windows1253': 'win1253',
        'windows1254': 'win1254',
        'windows1255': 'win1255',
        'windows1256': 'win1256',
        'windows1257': 'win1257',
        'windows1258': 'win1258',
        'shiftjis': 'shiftjis',
        'eucjp': 'eucjp',
        'iso2022jp': 'iso2022jp',
        'big5': 'big5',
        'gbk': 'gbk',
        'gb18030': 'gb18030',
        'euckr': 'euckr'
      };

      const mappedCharset = charsetMap[normalizedCharset] || normalizedCharset;

      // Use iconv-lite for decoding
      if (iconv.encodingExists(mappedCharset)) {
        return iconv.decode(buffer, mappedCharset);
      }

      // Fallback to UTF-8
      return buffer.toString('utf8');
    } catch (error) {
      console.error('Charset decode error:', error);
      return buffer.toString('utf8');
    }
  }

  private parseMessage(message: any) {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

    // Decode MIME encoded headers
    const from = this.decodeMimeHeader(getHeader('From'));
    const subject = this.decodeMimeHeader(getHeader('Subject'));
    const to = this.decodeMimeHeader(getHeader('To'));

    const { text, html } = this.extractBody(message.payload);

    return {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds,
      snippet: message.snippet,
      subject,
      from,
      to,
      date: getHeader('Date'),
      body: text || message.snippet || '', // Fallback to snippet if no body
      bodyHtml: html, // HTML version of the body
      hasAttachment: this.hasAttachments(message.payload),
      attachments: this.extractAttachments(message.payload),
    };
  }

  // Get charset from Content-Type header
  private getCharsetFromHeaders(headers: any[]): string {
    if (!headers) return 'utf-8';

    const contentType = headers.find((h: any) =>
      h.name?.toLowerCase() === 'content-type'
    )?.value || '';

    const charsetMatch = contentType.match(/charset[=:]?\s*["']?([^"'\s;]+)/i);
    return charsetMatch ? charsetMatch[1] : 'utf-8';
  }

  private extractBody(payload: any): { text: string; html: string } {
    let body = '';
    let htmlBody = '';

    // Helper function to decode base64 with charset support
    const decodeBase64 = (data: string, charset?: string): string => {
      try {
        // URLセーフなBase64を標準のBase64に変換
        const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
        // Add padding if needed
        const padding = base64.length % 4;
        const paddedBase64 = padding ? base64 + '='.repeat(4 - padding) : base64;

        // Decode to buffer
        const buffer = Buffer.from(paddedBase64, 'base64');

        // Use detected charset or default to UTF-8
        const detectedCharset = charset || 'utf-8';

        // Try decoding with detected charset
        if (detectedCharset.toLowerCase() !== 'utf-8') {
          try {
            return this.decodeWithCharset(buffer, detectedCharset);
          } catch (error) {
            console.log('Charset decode failed, falling back to UTF-8:', error);
          }
        }

        // Default UTF-8 decoding
        let decoded = buffer.toString('utf-8');

        // If UTF-8 fails (replacement characters), try common Japanese encodings
        if (decoded.includes('\ufffd')) {
          // Try ISO-2022-JP (common for Japanese emails)
          try {
            const isoDecoded = iconv.decode(buffer, 'iso-2022-jp');
            if (!isoDecoded.includes('\ufffd')) {
              return isoDecoded;
            }
          } catch (e) {}

          // Try Shift-JIS
          try {
            const sjisDecoded = iconv.decode(buffer, 'shift-jis');
            if (!sjisDecoded.includes('\ufffd')) {
              return sjisDecoded;
            }
          } catch (e) {}

          // Try EUC-JP
          try {
            const eucDecoded = iconv.decode(buffer, 'euc-jp');
            if (!eucDecoded.includes('\ufffd')) {
              return eucDecoded;
            }
          } catch (e) {}
        }

        return decoded;
      } catch (error) {
        console.error('Base64 decode error:', error);
        return '';
      }
    };

    // Helper function to convert HTML to text
    const htmlToText = (html: string): string => {
      let text = html;

      // Remove style and script tags with their content
      text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

      // Add line breaks for block elements
      text = text.replace(/<\/?(div|p|br|hr|h[1-6]|ul|ol|li|blockquote|pre|table|tr)[^>]*>/gi, '\n');

      // Add space for inline elements that typically have spacing
      text = text.replace(/<\/?(span|a|em|strong|b|i|u)[^>]*>/gi, ' ');

      // Remove all remaining HTML tags
      text = text.replace(/<[^>]+>/g, '');

      // Decode HTML entities
      text = text.replace(/&nbsp;/gi, ' ');
      text = text.replace(/&amp;/gi, '&');
      text = text.replace(/&lt;/gi, '<');
      text = text.replace(/&gt;/gi, '>');
      text = text.replace(/&quot;/gi, '"');
      text = text.replace(/&#39;/gi, "'");
      text = text.replace(/&rsquo;/gi, "'");
      text = text.replace(/&lsquo;/gi, "'");
      text = text.replace(/&rdquo;/gi, '"');
      text = text.replace(/&ldquo;/gi, '"');
      text = text.replace(/&mdash;/gi, '—');
      text = text.replace(/&ndash;/gi, '–');
      text = text.replace(/&hellip;/gi, '...');
      text = text.replace(/&bull;/gi, '•');
      text = text.replace(/&#(\d+);/gi, (match, num) => String.fromCharCode(parseInt(num)));
      text = text.replace(/&#x([0-9A-F]+);/gi, (match, num) => String.fromCharCode(parseInt(num, 16)));

      // Clean up whitespace
      text = text.replace(/\n\s*\n\s*\n/g, '\n\n'); // Remove multiple blank lines
      text = text.replace(/[ \t]+/g, ' '); // Replace multiple spaces/tabs with single space
      text = text.replace(/^\s+|\s+$/gm, ''); // Trim each line

      return text.trim();
    };

    // Recursive function to search all parts
    const searchParts = (part: any): void => {
      if (!part) return;

      // Get charset for this part
      const partCharset = this.getCharsetFromHeaders(part.headers || []);

      // Check current part for body data
      if (part.body?.data) {
        if (part.mimeType === 'text/plain' && !body) {
          const decoded = decodeBase64(part.body.data, partCharset);
          // Only use if it's not just whitespace
          if (decoded && decoded.trim().length > 0) {
            body = decoded;
          }
        } else if (part.mimeType === 'text/html' && !htmlBody) {
          htmlBody = decodeBase64(part.body.data, partCharset);
        }
      }

      // Recursively search nested parts
      if (part.parts && Array.isArray(part.parts)) {
        for (const subPart of part.parts) {
          searchParts(subPart);
        }
      }
    };

    // Start searching from the payload
    searchParts(payload);

    // Use plain text if found, otherwise convert HTML
    if (!body && htmlBody) {
      body = htmlToText(htmlBody);
    }

    // If still no body, check if payload has direct body data
    if (!body && !htmlBody && payload.body?.data) {
      const payloadCharset = this.getCharsetFromHeaders(payload.headers || []);
      const decoded = decodeBase64(payload.body.data, payloadCharset);
      if (payload.mimeType === 'text/html') {
        htmlBody = decoded;
        body = htmlToText(decoded);
      } else {
        body = decoded;
      }
    }

    return { text: body || '', html: htmlBody || '' };
  }

  private hasAttachments(payload: any): boolean {
    if (!payload.parts) return false;
    
    return payload.parts.some((part: any) => {
      if (part.filename && part.filename !== '') return true;
      if (part.parts) return this.hasAttachments(part);
      return false;
    });
  }

  private extractAttachments(payload: any): string[] {
    const attachments: string[] = [];
    
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.filename && part.filename !== '') {
          attachments.push(part.filename);
        }
        if (part.parts) {
          attachments.push(...this.extractAttachments(part));
        }
      }
    }
    
    return attachments;
  }

  private extractParticipants(messages: any[]): string[] {
    const participants = new Set<string>();

    messages.forEach(msg => {
      if (msg.from) {
        const sender = msg.from.match(/<(.+)>/)?.[1] || msg.from;
        participants.add(sender);
      }
      if (msg.to) {
        const recipients = msg.to.split(',').map((r: string) => {
          const email = r.trim().match(/<(.+)>/)?.[1] || r.trim();
          return email;
        });
        recipients.forEach((r: string) => participants.add(r));
      }
    });

    return Array.from(participants);
  }

  async toggleStar(messageId: string, starred: boolean) {
    try {
      if (starred) {
        // Add STARRED label
        await this.gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            addLabelIds: ['STARRED']
          }
        });
      } else {
        // Remove STARRED label
        await this.gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            removeLabelIds: ['STARRED']
          }
        });
      }
      return { success: true, starred };
    } catch (error) {
      console.error('Error toggling star:', error);
      throw error;
    }
  }

  async getMessage(messageId: string) {
    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
      });

      return this.parseMessage(response.data);
    } catch (error) {
      console.error('Error fetching message:', error);
      throw error;
    }
  }

  async markAsRead(messageId: string) {
    try {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['UNREAD']
        }
      });
      return { success: true };
    } catch (error) {
      console.error('Error marking as read:', error);
      throw error;
    }
  }

  async markAsUnread(messageId: string) {
    try {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: ['UNREAD']
        }
      });
      return { success: true };
    } catch (error) {
      console.error('Error marking as unread:', error);
      throw error;
    }
  }

  async sendEmail(to: string, subject: string, body: string, threadId?: string) {
    try {
      const message = [
        `To: ${to}`,
        `Subject: ${subject}`,
        '',
        body,
      ].join('\n');

      const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

      const params: any = {
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      };

      if (threadId) {
        params.requestBody.threadId = threadId;
      }

      const response = await this.gmail.users.messages.send(params);
      return response.data;
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }

  async archiveMessage(messageId: string) {
    try {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['INBOX']
        }
      });
      return { success: true };
    } catch (error) {
      console.error('Error archiving message:', error);
      throw error;
    }
  }

  async deleteMessage(messageId: string) {
    try {
      await this.gmail.users.messages.trash({
        userId: 'me',
        id: messageId
      });
      return { success: true };
    } catch (error) {
      console.error('Error deleting message:', error);
      throw error;
    }
  }

  async searchMessages(query: string, maxResults: number = 20) {
    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults
      });

      const messages = response.data.messages || [];

      const messageDetails = await Promise.all(
        messages.map(async (message: any) => {
          const detail = await this.gmail.users.messages.get({
            userId: 'me',
            id: message.id
          });
          return this.parseMessage(detail.data);
        })
      );

      return messageDetails;
    } catch (error) {
      console.error('Error searching messages:', error);
      throw error;
    }
  }

  async getAttachment(messageId: string, attachmentId: string) {
    try {
      const response = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId
      });
      return response.data;
    } catch (error) {
      console.error('Error getting attachment:', error);
      throw error;
    }
  }

  async createDraft(to: string, subject: string, body: string) {
    try {
      const message = [
        `To: ${to}`,
        `Subject: ${subject}`,
        '',
        body,
      ].join('\n');

      const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

      const response = await this.gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            raw: encodedMessage
          }
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error creating draft:', error);
      throw error;
    }
  }

  async updateDraft(draftId: string, to: string, subject: string, body: string) {
    try {
      const message = [
        `To: ${to}`,
        `Subject: ${subject}`,
        '',
        body,
      ].join('\n');

      const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

      const response = await this.gmail.users.drafts.update({
        userId: 'me',
        id: draftId,
        requestBody: {
          message: {
            raw: encodedMessage
          }
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error updating draft:', error);
      throw error;
    }
  }

  async getDrafts() {
    try {
      const response = await this.gmail.users.drafts.list({
        userId: 'me'
      });
      return response.data.drafts || [];
    } catch (error) {
      console.error('Error getting drafts:', error);
      throw error;
    }
  }
}