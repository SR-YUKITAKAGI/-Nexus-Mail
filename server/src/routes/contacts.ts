import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { ContactExtractor } from '../services/contactExtractor';
import { db } from '../services/database';

const router = Router();
const contactExtractor = new ContactExtractor();

router.get('/', requireAuth, async (req: any, res: Response) => {
  try {
    const { search, limit = 100, offset = 0, isVip, tags } = req.query;

    const contacts = await db.getContacts(req.user.id || 'default', {
      search: search as string,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      isVip: isVip === 'true',
      tags: tags ? (tags as string).split(',') : undefined
    });

    const stats = await db.getContactStats(req.user.id || 'default');

    res.json({
      contacts,
      total: stats.total_contacts,
      stats
    });
  } catch (error: any) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', requireAuth, async (req: any, res: Response) => {
  try {
    const contact = await db.getContact(req.params.id, req.user.id || 'default');

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json(contact);
  } catch (error: any) {
    console.error('Error fetching contact:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/extract', requireAuth, async (req: any, res: Response) => {
  const { emailBody, senderEmail, emailId } = req.body;

  if (!emailBody || !senderEmail) {
    res.status(400).json({ error: 'Email body and sender email required' });
    return;
  }

  try {
    const extractedInfo = contactExtractor.extractFromSignature(emailBody, senderEmail);

    const contact = {
      email: senderEmail,
      name: extractedInfo.name,
      company: extractedInfo.company,
      position: extractedInfo.title,
      phone: extractedInfo.phone,
      sourceEmailIds: emailId ? [emailId] : [],
      lastEmailDate: new Date(),
      metadata: {
        department: extractedInfo.department,
        address: extractedInfo.address
      }
    };

    await db.saveContact(contact, req.user.id || 'default');

    res.json({
      contact,
      extracted: extractedInfo
    });
  } catch (error) {
    console.error('Contact extraction error:', error);
    res.status(500).json({ error: 'Failed to extract contact information' });
  }
});

router.post('/', requireAuth, async (req: any, res: Response) => {
  const { email, name, company, position, phone, notes, tags, isVip } = req.body;

  if (!email || !name) {
    res.status(400).json({ error: 'Email and name are required' });
    return;
  }

  try {
    const contact = {
      email,
      name,
      company,
      position,
      phone,
      notes,
      tags,
      isVip,
      metadata: { source: 'manual' }
    };

    await db.saveContact(contact, req.user.id || 'default');

    res.status(201).json(contact);
  } catch (error: any) {
    console.error('Error creating contact:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', requireAuth, async (req: any, res: Response) => {
  try {
    await db.updateContact(req.params.id, req.user.id || 'default', req.body);
    const updatedContact = await db.getContact(req.params.id, req.user.id || 'default');

    if (!updatedContact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json(updatedContact);
  } catch (error: any) {
    console.error('Error updating contact:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', requireAuth, async (req: any, res: Response) => {
  try {
    await db.deleteContact(req.params.id, req.user.id || 'default');
    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sync contacts from existing analyzed emails
router.post('/sync', requireAuth, async (req: any, res: Response) => {
  try {
    const userId = req.user.id || 'default';

    // Get all analyzed emails
    const analyses = await db.getRecentAnalyses(userId, 1000);

    let contactsExtracted = 0;

    for (const analysis of analyses) {
      // Extract sender info
      if (analysis.from) {
        const fromParts = analysis.from.match(/^(.*?)\s*<(.+)>$/);
        const senderEmail = fromParts ? fromParts[2] : analysis.from;
        const senderName = fromParts ? fromParts[1] : senderEmail.split('@')[0];

        if (!senderEmail.match(/(noreply|no-reply|donotreply|notification|mailer-daemon|postmaster)/i)) {
          await db.saveContact({
            email: senderEmail.toLowerCase(),
            name: senderName,
            sourceEmailIds: [analysis.emailId],
            firstEmailDate: analysis.emailDate,
            lastEmailDate: analysis.emailDate,
            totalEmailsReceived: 1,
            relationshipScore: 5,
            metadata: {
              emailType: analysis.analysis.emailType,
              extractedFrom: analysis.emailId
            }
          }, userId);

          contactsExtracted++;
        }
      }

      // Extract contacts from analysis if available
      if (analysis.analysis.contacts) {
        for (const contact of analysis.analysis.contacts) {
          await db.saveContact({
            email: contact.email.toLowerCase(),
            name: contact.name || contact.email.split('@')[0],
            company: contact.company,
            position: contact.role,
            phone: contact.phone,
            sourceEmailIds: [analysis.emailId],
            firstEmailDate: analysis.emailDate,
            lastEmailDate: analysis.emailDate,
            totalEmailsReceived: 1,
            relationshipScore: 10,
            metadata: {
              relationship: contact.relationship || 'unknown',
              extractedFrom: analysis.emailId
            }
          }, userId);

          contactsExtracted++;
        }
      }
    }

    const stats = await db.getContactStats(userId);

    res.json({
      success: true,
      contactsExtracted,
      totalAnalyzed: analyses.length,
      stats
    });
  } catch (error: any) {
    console.error('Error syncing contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;