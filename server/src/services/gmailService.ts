import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export class GmailService {
  private oauth2Client: OAuth2Client;
  private gmail: any;

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

  private parseMessage(message: any) {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

    return {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds,
      snippet: message.snippet,
      subject: getHeader('Subject'),
      from: getHeader('From'),
      to: getHeader('To'),
      date: getHeader('Date'),
      body: this.extractBody(message.payload),
      hasAttachment: this.hasAttachments(message.payload),
      attachments: this.extractAttachments(message.payload),
    };
  }

  private extractBody(payload: any): string {
    let body = '';

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8');
          break;
        } else if (part.mimeType === 'text/html' && part.body?.data && !body) {
          const htmlContent = Buffer.from(part.body.data, 'base64').toString('utf-8');
          // Simple HTML to text conversion
          body = htmlContent
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style tags
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script tags
            .replace(/<[^>]+>/g, ' ') // Remove HTML tags
            .replace(/&nbsp;/g, ' ') // Replace nbsp
            .replace(/&amp;/g, '&') // Replace amp
            .replace(/&lt;/g, '<') // Replace lt
            .replace(/&gt;/g, '>') // Replace gt
            .replace(/&quot;/g, '"') // Replace quot
            .replace(/&#39;/g, "'") // Replace apostrophe
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim();
        } else if (part.parts) {
          body = this.extractBody(part);
          if (body) break;
        }
      }
    } else if (payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      // Apply HTML stripping if needed
      if (payload.mimeType === 'text/html') {
        body = body
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
      }
    }

    return body;
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
}