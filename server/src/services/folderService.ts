import { gmail_v1 } from 'googleapis';

export interface EmailFolder {
  id: string;
  name: string;
  type: 'system' | 'custom';
  messageCount?: number;
  unreadCount?: number;
  icon?: string;
}

export class FolderService {
  private gmail: gmail_v1.Gmail;

  constructor(gmail: gmail_v1.Gmail) {
    this.gmail = gmail;
  }

  async getFolders(): Promise<EmailFolder[]> {
    try {
      const response = await this.gmail.users.labels.list({
        userId: 'me'
      });

      const labels = response.data.labels || [];

      const folders: EmailFolder[] = labels.map(label => ({
        id: label.id!,
        name: this.formatLabelName(label.name!),
        type: label.type === 'system' ? 'system' : 'custom',
        messageCount: label.messagesTotal || undefined,
        unreadCount: label.messagesUnread || undefined,
        icon: this.getLabelIcon(label.name!)
      }));

      // Sort: system folders first, then custom alphabetically
      return folders.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'system' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    } catch (error) {
      console.error('Error fetching folders:', error);
      throw error;
    }
  }

  async createFolder(name: string): Promise<EmailFolder> {
    try {
      const response = await this.gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show'
        }
      });

      return {
        id: response.data.id!,
        name,
        type: 'custom',
        messageCount: 0,
        unreadCount: 0,
        icon: '📁'
      };
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  }

  async deleteFolder(folderId: string): Promise<void> {
    try {
      await this.gmail.users.labels.delete({
        userId: 'me',
        id: folderId
      });
    } catch (error) {
      console.error('Error deleting folder:', error);
      throw error;
    }
  }

  async moveToFolder(messageIds: string[], folderId: string, removeFromInbox = true): Promise<void> {
    try {
      const addLabelIds = [folderId];
      const removeLabelIds = removeFromInbox ? ['INBOX'] : [];

      await Promise.all(messageIds.map(messageId =>
        this.gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            addLabelIds,
            removeLabelIds
          }
        })
      ));
    } catch (error) {
      console.error('Error moving messages to folder:', error);
      throw error;
    }
  }

  async getMessagesInFolder(folderId: string, maxResults = 50): Promise<any[]> {
    try {
      const query = folderId === 'ALL' ? '' : `label:${folderId}`;

      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults
      });

      const messages = response.data.messages || [];

      // Fetch full message details
      const fullMessages = await Promise.all(
        messages.map(msg =>
          this.gmail.users.messages.get({
            userId: 'me',
            id: msg.id!
          })
        )
      );

      return fullMessages.map(res => res.data);
    } catch (error) {
      console.error('Error fetching messages in folder:', error);
      throw error;
    }
  }

  private formatLabelName(name: string): string {
    // Gmail system labels are in uppercase
    const labelMap: Record<string, string> = {
      'INBOX': 'Inbox',
      'SENT': 'Sent',
      'DRAFT': 'Drafts',
      'SPAM': 'Spam',
      'TRASH': 'Trash',
      'STARRED': 'Starred',
      'IMPORTANT': 'Important',
      'UNREAD': 'Unread',
      'CATEGORY_PERSONAL': 'Personal',
      'CATEGORY_SOCIAL': 'Social',
      'CATEGORY_PROMOTIONS': 'Promotions',
      'CATEGORY_UPDATES': 'Updates',
      'CATEGORY_FORUMS': 'Forums'
    };

    return labelMap[name] || name;
  }

  private getLabelIcon(name: string): string {
    const iconMap: Record<string, string> = {
      'INBOX': '📥',
      'SENT': '📤',
      'DRAFT': '📝',
      'SPAM': '🚫',
      'TRASH': '🗑️',
      'STARRED': '⭐',
      'IMPORTANT': '❗',
      'UNREAD': '🔵',
      'CATEGORY_PERSONAL': '👤',
      'CATEGORY_SOCIAL': '👥',
      'CATEGORY_PROMOTIONS': '📢',
      'CATEGORY_UPDATES': '🔔',
      'CATEGORY_FORUMS': '💬'
    };

    return iconMap[name] || '📁';
  }
}