import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { CalendarExtractor, CalendarEvent } from '../services/calendarExtractor';

const router = Router();
const calendarExtractor = new CalendarExtractor();

// In-memory storage for demo
const eventsDB = new Map<string, CalendarEvent[]>();

// Get all calendar events
router.get('/events', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const userEvents = eventsDB.get(userId) || [];

  // Sort by date
  const sortedEvents = userEvents.sort((a, b) =>
    a.date.getTime() - b.date.getTime()
  );

  // Group by date
  const groupedEvents = sortedEvents.reduce((acc, event) => {
    const dateKey = event.date.toISOString().split('T')[0];
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(event);
    return acc;
  }, {} as Record<string, CalendarEvent[]>);

  res.json({
    events: sortedEvents,
    grouped: groupedEvents,
    total: sortedEvents.length,
    upcoming: sortedEvents.filter(e => e.date >= new Date()).length
  });
});

// Extract events from email
router.post('/extract', requireAuth, (req: Request, res: Response) => {
  const { emailBody, subject, from, emailId } = req.body;
  const userId = (req.user as any).id;

  if (!emailBody || !subject || !from || !emailId) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    const extractedEvents = calendarExtractor.extractEvents(
      emailBody,
      subject,
      from,
      emailId
    );

    if (extractedEvents.length === 0) {
      res.json({ extracted: false, message: 'No calendar events found' });
      return;
    }

    // Store the events
    const userEvents = eventsDB.get(userId) || [];

    // Check for duplicates
    const newEvents = extractedEvents.filter(event =>
      !userEvents.some(e => e.emailId === event.emailId && e.title === event.title)
    );

    userEvents.push(...newEvents);
    eventsDB.set(userId, userEvents);

    res.json({
      extracted: true,
      events: extractedEvents,
      newCount: newEvents.length
    });
  } catch (error) {
    console.error('Calendar extraction error:', error);
    res.status(500).json({ error: 'Failed to extract calendar events' });
  }
});

// Create manual event
router.post('/events', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { title, date, time, location, description, type = 'event' } = req.body;

  if (!title || !date) {
    res.status(400).json({ error: 'Title and date are required' });
    return;
  }

  const event: CalendarEvent = {
    id: `manual-${Date.now()}`,
    title,
    date: new Date(date),
    time,
    location,
    description,
    type: type as any,
    source: 'email',
    emailId: '',
    confidence: 1.0
  };

  const userEvents = eventsDB.get(userId) || [];
  userEvents.push(event);
  eventsDB.set(userId, userEvents);

  res.status(201).json(event);
});

// Update event
router.put('/events/:eventId', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { eventId } = req.params;

  const userEvents = eventsDB.get(userId) || [];
  const eventIndex = userEvents.findIndex(e => e.id === eventId);

  if (eventIndex === -1) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  const updatedEvent = {
    ...userEvents[eventIndex],
    ...req.body,
    id: eventId // Preserve ID
  };

  userEvents[eventIndex] = updatedEvent;
  eventsDB.set(userId, userEvents);

  res.json(updatedEvent);
});

// Delete event
router.delete('/events/:eventId', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { eventId } = req.params;

  const userEvents = eventsDB.get(userId) || [];
  const filtered = userEvents.filter(e => e.id !== eventId);

  if (filtered.length === userEvents.length) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  eventsDB.set(userId, filtered);
  res.status(204).send();
});

// Get upcoming events
router.get('/upcoming', requireAuth, (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { days = '7' } = req.query;

  const userEvents = eventsDB.get(userId) || [];
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + parseInt(days as string));

  const upcomingEvents = userEvents
    .filter(e => e.date >= now && e.date <= futureDate)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  res.json({
    events: upcomingEvents,
    count: upcomingEvents.length,
    dateRange: {
      from: now.toISOString(),
      to: futureDate.toISOString()
    }
  });
});

export default router;