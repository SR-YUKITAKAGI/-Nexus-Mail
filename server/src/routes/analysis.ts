import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { UnifiedEmailAnalyzer } from '../services/unifiedEmailAnalyzer';

const router = Router();
const analyzer = new UnifiedEmailAnalyzer();

// Store analyzed results (in-memory for demo)
const analysisDB = new Map<string, any>();
const contactsDB = new Map<string, any[]>();
const tasksDB = new Map<string, any[]>();
const eventsDB = new Map<string, any[]>();

// Analyze a single email
router.post('/analyze', requireAuth, async (req: Request, res: Response) => {
  const { emailBody, subject, from, to, cc, emailId, timestamp } = req.body;
  const userId = (req.user as any).id;

  if (!emailBody || !subject || !from || !emailId) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    const analysis = await analyzer.analyzeEmail(
      emailBody,
      subject,
      from,
      emailId,
      to,
      cc
    );

    if (!analysis) {
      res.json({ analyzed: false, message: 'Could not analyze email' });
      return;
    }

    // Store analysis results
    const key = `${userId}_${emailId}`;
    analysisDB.set(key, {
      ...analysis,
      emailId,
      timestamp: timestamp || new Date().toISOString(),
      userId
    });

    // Extract and store contacts
    if (analysis.contacts && analysis.contacts.length > 0) {
      const userContacts = contactsDB.get(userId) || [];
      analysis.contacts.forEach(contact => {
        // Check if contact already exists
        const exists = userContacts.some(c => c.email === contact.email);
        if (!exists) {
          userContacts.push({
            ...contact,
            addedFrom: emailId,
            addedDate: new Date().toISOString()
          });
        }
      });
      contactsDB.set(userId, userContacts);
    }

    // Extract and store tasks
    if (analysis.discovery?.actionItems && analysis.discovery.actionItems.length > 0) {
      const userTasks = tasksDB.get(userId) || [];
      analysis.discovery.actionItems.forEach(task => {
        userTasks.push({
          id: `task_${emailId}_${Date.now()}`,
          task,
          source: emailId,
          createdDate: new Date().toISOString(),
          status: 'pending',
          priority: analysis.priority,
          deadlines: analysis.discovery?.deadlines
        });
      });
      tasksDB.set(userId, userTasks);
    }

    // Extract and store events
    if (analysis.event && analysis.event.isEvent) {
      const userEvents = eventsDB.get(userId) || [];
      userEvents.push({
        id: `event_${emailId}_${Date.now()}`,
        ...analysis.event,
        source: emailId,
        addedDate: new Date().toISOString()
      });
      eventsDB.set(userId, userEvents);
    }

    res.json({
      analyzed: true,
      analysis,
      extractedData: {
        contacts: analysis.contacts?.length || 0,
        tasks: analysis.discovery?.actionItems?.length || 0,
        events: analysis.event?.isEvent ? 1 : 0
      }
    });
  } catch (error) {
    console.error('Email analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze email' });
  }
});

// Batch analyze emails
router.post('/batch-analyze', requireAuth, async (req: Request, res: Response) => {
  const { emails } = req.body;
  const userId = (req.user as any).id;

  if (!emails || !Array.isArray(emails)) {
    res.status(400).json({ error: 'Invalid emails array' });
    return;
  }

  try {
    const results = await analyzer.batchAnalyze(emails);

    // Store all results
    results.forEach((analysis, emailId) => {
      const key = `${userId}_${emailId}`;
      analysisDB.set(key, {
        ...analysis,
        emailId,
        timestamp: new Date().toISOString(),
        userId
      });

      // Process contacts, tasks, events as in single analyze
      if (analysis.contacts) {
        const userContacts = contactsDB.get(userId) || [];
        analysis.contacts.forEach(contact => {
          if (!userContacts.some(c => c.email === contact.email)) {
            userContacts.push({
              ...contact,
              addedFrom: emailId,
              addedDate: new Date().toISOString()
            });
          }
        });
        contactsDB.set(userId, userContacts);
      }
    });

    res.json({
      analyzed: true,
      totalEmails: emails.length,
      analyzedCount: results.size,
      results: Array.from(results.entries()).map(([emailId, analysis]) => ({
        emailId,
        type: analysis.emailType,
        category: analysis.category,
        priority: analysis.priority
      }))
    });
  } catch (error) {
    console.error('Batch analysis error:', error);
    res.status(500).json({ error: 'Failed to batch analyze emails' });
  }
});

// Get analysis for specific email
router.get('/email/:emailId', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { emailId } = req.params;

  const key = `${userId}_${emailId}`;
  const analysis = analysisDB.get(key);

  if (!analysis) {
    res.status(404).json({ error: 'Analysis not found' });
    return;
  }

  res.json({ analysis });
});

// Get all contacts
router.get('/contacts', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const contacts = contactsDB.get(userId) || [];

  res.json({
    contacts,
    total: contacts.length
  });
});

// Get all tasks
router.get('/tasks', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const tasks = tasksDB.get(userId) || [];

  res.json({
    tasks: tasks.filter(t => t.status !== 'completed'),
    completed: tasks.filter(t => t.status === 'completed'),
    total: tasks.length
  });
});

// Update task status
router.patch('/tasks/:taskId', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { taskId } = req.params;
  const { status } = req.body;

  const tasks = tasksDB.get(userId) || [];
  const task = tasks.find(t => t.id === taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  task.status = status;
  tasksDB.set(userId, tasks);

  res.json({ task });
});

// Get all events
router.get('/events', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const events = eventsDB.get(userId) || [];

  res.json({
    events: events.sort((a, b) =>
      new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()
    ),
    total: events.length
  });
});

// Get email categorization summary
router.get('/categories', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const userAnalyses = Array.from(analysisDB.entries())
    .filter(([key]) => key.startsWith(userId))
    .map(([, analysis]) => analysis);

  const categorySummary = userAnalyses.reduce((acc, analysis) => {
    const cat = analysis.category || 'Other';
    const type = analysis.emailType || 'other';

    if (!acc[cat]) {
      acc[cat] = { count: 0, types: {} };
    }

    acc[cat].count++;
    acc[cat].types[type] = (acc[cat].types[type] || 0) + 1;

    return acc;
  }, {} as Record<string, any>);

  res.json({
    categories: categorySummary,
    totalAnalyzed: userAnalyses.length
  });
});

// Get discovery insights
router.get('/discovery', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const userAnalyses = Array.from(analysisDB.entries())
    .filter(([key]) => key.startsWith(userId))
    .map(([, analysis]) => analysis);

  // Aggregate topics and mentions
  const topics = new Map<string, number>();
  const mentions = new Map<string, number>();
  const sentiments = { positive: 0, neutral: 0, negative: 0 };
  let totalImportance = 0;

  userAnalyses.forEach(analysis => {
    if (analysis.discovery) {
      // Count topics
      analysis.discovery.keyTopics?.forEach((topic: string) => {
        topics.set(topic, (topics.get(topic) || 0) + 1);
      });

      // Count mentions
      analysis.discovery.mentions?.forEach((mention: string) => {
        mentions.set(mention, (mentions.get(mention) || 0) + 1);
      });

      // Count sentiments
      if (analysis.discovery.sentiment) {
        sentiments[analysis.discovery.sentiment as keyof typeof sentiments]++;
      }

      // Sum importance
      totalImportance += analysis.discovery.importance || 0;
    }
  });

  // Get top topics and mentions
  const topTopics = Array.from(topics.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([topic, count]) => ({ topic, count }));

  const topMentions = Array.from(mentions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([mention, count]) => ({ mention, count }));

  res.json({
    insights: {
      topTopics,
      topMentions,
      sentiments,
      averageImportance: userAnalyses.length > 0 ? totalImportance / userAnalyses.length : 0,
      highPriorityCount: userAnalyses.filter(a => a.priority === 'high').length,
      suggestedActions: userAnalyses
        .filter(a => a.suggestedActions && a.suggestedActions.length > 0)
        .slice(0, 5)
        .map(a => ({
          emailId: a.emailId,
          actions: a.suggestedActions,
          priority: a.priority
        }))
    }
  });
});

// Clear all analysis data (for debugging)
router.delete('/clear', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;

  // Clear user data from all stores
  const keysToDelete = Array.from(analysisDB.keys()).filter(k => k.startsWith(userId));
  keysToDelete.forEach(key => analysisDB.delete(key));

  contactsDB.delete(userId);
  tasksDB.delete(userId);
  eventsDB.delete(userId);

  res.json({ success: true, message: 'All analysis data cleared' });
});

// Get AI analysis statistics
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  const analyzer = new UnifiedEmailAnalyzer();
  const stats = analyzer.getStats();

  // Calculate savings from promotional email filtering
  const apiCallsSaved = stats.promotionalSenders * 10; // Estimate 10 emails per promotional sender
  const costSaved = (apiCallsSaved * 1000 / 1000000) * 0.25; // Haiku pricing

  res.json({
    ...stats,
    apiCallsSaved,
    estimatedCostSaved: `$${costSaved.toFixed(4)}`,
    filteringEfficiency: stats.totalSenders > 0
      ? `${((stats.promotionalSenders / stats.totalSenders) * 100).toFixed(1)}%`
      : '0%'
  });
});

export default router;