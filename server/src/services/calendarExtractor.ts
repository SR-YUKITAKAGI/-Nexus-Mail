export interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  endDate?: Date;
  time?: string;
  location?: string;
  description?: string;
  attendees?: string[];
  organizer?: string;
  type: 'meeting' | 'appointment' | 'event' | 'reminder' | 'deadline';
  source: 'email';
  emailId: string;
  confidence: number;
}

export class CalendarExtractor {
  private monthPatterns: { [key: string]: number } = {
    'january': 1, 'jan': 1, '1月': 1,
    'february': 2, 'feb': 2, '2月': 2,
    'march': 3, 'mar': 3, '3月': 3,
    'april': 4, 'apr': 4, '4月': 4,
    'may': 5, '5月': 5,
    'june': 6, 'jun': 6, '6月': 6,
    'july': 7, 'jul': 7, '7月': 7,
    'august': 8, 'aug': 8, '8月': 8,
    'september': 9, 'sep': 9, 'sept': 9, '9月': 9,
    'october': 10, 'oct': 10, '10月': 10,
    'november': 11, 'nov': 11, '11月': 11,
    'december': 12, 'dec': 12, '12月': 12
  };

  extractEvents(emailBody: string, subject: string, from: string, emailId: string): CalendarEvent[] {
    const events: CalendarEvent[] = [];

    // Check for meeting invitations
    const meetingEvent = this.extractMeeting(emailBody, subject, from, emailId);
    if (meetingEvent) events.push(meetingEvent);

    // Check for appointments
    const appointmentEvent = this.extractAppointment(emailBody, subject, emailId);
    if (appointmentEvent) events.push(appointmentEvent);

    // Check for deadlines
    const deadlineEvents = this.extractDeadlines(emailBody, subject, emailId);
    events.push(...deadlineEvents);

    // Check for general events
    const generalEvents = this.extractGeneralEvents(emailBody, subject, emailId);
    events.push(...generalEvents);

    return events;
  }

  private extractMeeting(body: string, subject: string, from: string, emailId: string): CalendarEvent | null {
    const meetingPatterns = [
      /meeting.{0,20}(?:on|at|scheduled for)\s+([^.]+)/i,
      /(?:conference|call|sync|standup).{0,20}(?:on|at)\s+([^.]+)/i,
      /invite you to.{0,50}(?:on|at)\s+([^.]+)/i,
      /会議.{0,20}(\d{1,2}月\d{1,2}日)/,
      /ミーティング.{0,20}(\d{1,2}\/\d{1,2})/
    ];

    for (const pattern of meetingPatterns) {
      const match = (body + ' ' + subject).match(pattern);
      if (match) {
        const dateTime = this.parseDateTime(match[1]);
        if (dateTime) {
          const location = this.extractLocation(body);
          const attendees = this.extractAttendees(body);

          return {
            id: `meeting-${emailId}-${Date.now()}`,
            title: this.extractMeetingTitle(subject, body),
            date: dateTime.date,
            time: dateTime.time,
            location,
            attendees,
            organizer: from,
            type: 'meeting',
            source: 'email',
            emailId,
            confidence: 0.8
          };
        }
      }
    }

    return null;
  }

  private extractAppointment(body: string, subject: string, emailId: string): CalendarEvent | null {
    const appointmentPatterns = [
      /appointment.{0,20}(?:on|at|scheduled for)\s+([^.]+)/i,
      /(?:visit|consultation|session).{0,20}(?:on|at)\s+([^.]+)/i,
      /予約.{0,20}(\d{1,2}月\d{1,2}日)/,
      /診察.{0,20}(\d{1,2}\/\d{1,2})/
    ];

    for (const pattern of appointmentPatterns) {
      const match = (body + ' ' + subject).match(pattern);
      if (match) {
        const dateTime = this.parseDateTime(match[1]);
        if (dateTime) {
          return {
            id: `appointment-${emailId}-${Date.now()}`,
            title: this.extractAppointmentTitle(subject, body),
            date: dateTime.date,
            time: dateTime.time,
            location: this.extractLocation(body),
            type: 'appointment',
            source: 'email',
            emailId,
            confidence: 0.75
          };
        }
      }
    }

    return null;
  }

  private extractDeadlines(body: string, subject: string, emailId: string): CalendarEvent[] {
    const deadlines: CalendarEvent[] = [];
    const deadlinePatterns = [
      /(?:deadline|due date|due by|submit by|expires?).{0,20}(?:is|on|:)?\s*([^.]+)/i,
      /(?:must be|should be|needs to be).{0,20}(?:submitted|completed|done).{0,20}(?:by|before)\s+([^.]+)/i,
      /締切.{0,20}(\d{1,2}月\d{1,2}日)/,
      /期限.{0,20}(\d{1,2}\/\d{1,2})/
    ];

    for (const pattern of deadlinePatterns) {
      const matches = (body + ' ' + subject).matchAll(new RegExp(pattern, 'gi'));
      for (const match of matches) {
        const dateTime = this.parseDateTime(match[1]);
        if (dateTime) {
          deadlines.push({
            id: `deadline-${emailId}-${Date.now()}-${deadlines.length}`,
            title: this.extractDeadlineTitle(match[0], subject),
            date: dateTime.date,
            time: dateTime.time,
            type: 'deadline',
            source: 'email',
            emailId,
            confidence: 0.7
          });
        }
      }
    }

    return deadlines;
  }

  private extractGeneralEvents(body: string, subject: string, emailId: string): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    const eventPatterns = [
      /(?:event|seminar|workshop|webinar|conference).{0,20}(?:on|at)\s+([^.]+)/i,
      /(?:save the date|mark your calendar).{0,20}(?:for)?\s+([^.]+)/i,
      /イベント.{0,20}(\d{1,2}月\d{1,2}日)/,
      /セミナー.{0,20}(\d{1,2}\/\d{1,2})/
    ];

    for (const pattern of eventPatterns) {
      const matches = (body + ' ' + subject).matchAll(new RegExp(pattern, 'gi'));
      for (const match of matches) {
        const dateTime = this.parseDateTime(match[1]);
        if (dateTime) {
          events.push({
            id: `event-${emailId}-${Date.now()}-${events.length}`,
            title: this.extractEventTitle(match[0], subject),
            date: dateTime.date,
            time: dateTime.time,
            location: this.extractLocation(body),
            type: 'event',
            source: 'email',
            emailId,
            confidence: 0.65
          });
        }
      }
    }

    return events;
  }

  private parseDateTime(text: string): { date: Date; time?: string } | null {
    if (!text) return null;

    const cleanText = text.toLowerCase().trim();

    // Try various date formats
    const patterns = [
      // MM/DD/YYYY or MM-DD-YYYY
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
      // Month DD, YYYY
      /([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/,
      // DD Month YYYY
      /(\d{1,2})\s+([a-z]+)\s+(\d{4})/,
      // Tomorrow, next week, etc.
      /(tomorrow|today|next\s+\w+|this\s+\w+)/,
      // Japanese format
      /(\d{4})年(\d{1,2})月(\d{1,2})日/,
      /(\d{1,2})月(\d{1,2})日/
    ];

    let date: Date | null = null;
    let time: string | undefined;

    // Extract time if present
    const timeMatch = cleanText.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|時)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const ampm = timeMatch[3]?.toLowerCase();

      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;

      time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    // Try to parse date
    for (const pattern of patterns) {
      const match = cleanText.match(pattern);
      if (match) {
        // Handle relative dates
        if (match[1] === 'tomorrow') {
          date = new Date();
          date.setDate(date.getDate() + 1);
        } else if (match[1] === 'today') {
          date = new Date();
        } else if (match[0].includes('next')) {
          date = this.parseRelativeDate(match[0]);
        } else if (pattern.source.includes('\\d{1,2}[') && match[1] && match[2]) {
          // Numeric date formats
          const month = parseInt(match[1]);
          const day = parseInt(match[2]);
          const year = match[3] ?
            (match[3].length === 2 ? 2000 + parseInt(match[3]) : parseInt(match[3])) :
            new Date().getFullYear();

          if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            date = new Date(year, month - 1, day);
          }
        } else if (match[1] && match[2] && match[3]) {
          // Text month formats
          const monthStr = match[1];
          const monthNum = this.monthPatterns[monthStr];
          if (monthNum) {
            const day = parseInt(match[2]);
            const year = parseInt(match[3]);
            date = new Date(year, monthNum - 1, day);
          }
        }

        if (date) break;
      }
    }

    return date ? { date, time } : null;
  }

  private parseRelativeDate(text: string): Date {
    const date = new Date();

    if (text.includes('week')) {
      date.setDate(date.getDate() + 7);
    } else if (text.includes('month')) {
      date.setMonth(date.getMonth() + 1);
    } else if (text.includes('monday')) {
      const daysUntilMonday = (8 - date.getDay()) % 7 || 7;
      date.setDate(date.getDate() + daysUntilMonday);
    } else if (text.includes('tuesday')) {
      const daysUntilTuesday = (9 - date.getDay()) % 7 || 7;
      date.setDate(date.getDate() + daysUntilTuesday);
    } else if (text.includes('wednesday')) {
      const daysUntilWednesday = (10 - date.getDay()) % 7 || 7;
      date.setDate(date.getDate() + daysUntilWednesday);
    } else if (text.includes('thursday')) {
      const daysUntilThursday = (11 - date.getDay()) % 7 || 7;
      date.setDate(date.getDate() + daysUntilThursday);
    } else if (text.includes('friday')) {
      const daysUntilFriday = (12 - date.getDay()) % 7 || 7;
      date.setDate(date.getDate() + daysUntilFriday);
    }

    return date;
  }

  private extractLocation(body: string): string | undefined {
    const locationPatterns = [
      /(?:location|venue|address|where|at|meeting room|conference room):\s*([^\n]+)/i,
      /(?:at|in)\s+(room\s+[^\s,]+)/i,
      /(?:zoom|teams|meet|skype)\.(?:us|com)\/[^\s]+/i,
      /場所[:：]\s*([^\n]+)/,
      /会議室[:：]\s*([^\n]+)/
    ];

    for (const pattern of locationPatterns) {
      const match = body.match(pattern);
      if (match) {
        return match[1]?.trim() || match[0]?.trim();
      }
    }

    return undefined;
  }

  private extractAttendees(body: string): string[] {
    const attendees: string[] = [];
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const matches = body.match(emailPattern);

    if (matches) {
      attendees.push(...matches);
    }

    return [...new Set(attendees)]; // Remove duplicates
  }

  private extractMeetingTitle(subject: string, body: string): string {
    if (subject.toLowerCase().includes('meeting') ||
        subject.toLowerCase().includes('call') ||
        subject.toLowerCase().includes('sync')) {
      return subject;
    }

    const titleMatch = body.match(/(?:meeting|call|sync|conference)\s+(?:about|for|regarding|on|:)\s*([^\n.]+)/i);
    return titleMatch ? titleMatch[1].trim() : 'Meeting';
  }

  private extractAppointmentTitle(subject: string, body: string): string {
    if (subject.toLowerCase().includes('appointment') ||
        subject.toLowerCase().includes('consultation')) {
      return subject;
    }

    const titleMatch = body.match(/(?:appointment|consultation|visit)\s+(?:for|with|at|:)\s*([^\n.]+)/i);
    return titleMatch ? titleMatch[1].trim() : 'Appointment';
  }

  private extractDeadlineTitle(text: string, subject: string): string {
    const cleanText = text.replace(/deadline|due date|due by|submit by|expires?/gi, '').trim();
    return cleanText.length > 10 ? (subject || 'Deadline') : (cleanText || subject || 'Deadline');
  }

  private extractEventTitle(text: string, subject: string): string {
    const cleanText = text.replace(/event|seminar|workshop|webinar|conference/gi, '').trim();
    return cleanText.length > 10 ? (subject || 'Event') : (cleanText || subject || 'Event');
  }
}