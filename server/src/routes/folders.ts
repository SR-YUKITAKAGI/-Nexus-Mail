import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { GmailService } from '../services/gmailService';
import { FolderService } from '../services/folderService';

const router = Router();

// Get all folders/labels
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const folderService = new FolderService(gmailService.gmail);

    const folders = await folderService.getFolders();
    res.json({ folders });
  } catch (error) {
    console.error('Error fetching folders:', error);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// Create new folder
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const { name } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Folder name is required' });
      return;
    }

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const folderService = new FolderService(gmailService.gmail);

    const folder = await folderService.createFolder(name);
    res.status(201).json({ folder });
  } catch (error) {
    console.error('Error creating folder:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Delete folder
router.delete('/:folderId', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const { folderId } = req.params;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const folderService = new FolderService(gmailService.gmail);

    await folderService.deleteFolder(folderId);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting folder:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// Move messages to folder
router.post('/:folderId/move', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const { folderId } = req.params;
    const { messageIds, removeFromInbox = true } = req.body;

    if (!messageIds || !Array.isArray(messageIds)) {
      res.status(400).json({ error: 'Message IDs array is required' });
      return;
    }

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const folderService = new FolderService(gmailService.gmail);

    await folderService.moveToFolder(messageIds, folderId, removeFromInbox);
    res.json({ success: true, movedCount: messageIds.length });
  } catch (error) {
    console.error('Error moving messages:', error);
    res.status(500).json({ error: 'Failed to move messages' });
  }
});

// Get messages in folder
router.get('/:folderId/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const { folderId } = req.params;
    const { maxResults = '50' } = req.query;

    const gmailService = new GmailService(user.accessToken, user.refreshToken);
    const folderService = new FolderService(gmailService.gmail);

    const messages = await folderService.getMessagesInFolder(
      folderId,
      parseInt(maxResults as string)
    );

    res.json({ messages, total: messages.length });
  } catch (error) {
    console.error('Error fetching messages in folder:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

export default router;