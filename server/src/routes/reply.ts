import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Generate reply template on demand
router.post('/generate', requireAuth, async (req: Request, res: Response) => {
  const { emailContent, subject, from, context } = req.body;

  if (!emailContent || !subject) {
    res.status(400).json({ error: 'Email content and subject are required' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const useMock = process.env.USE_MOCK_AI === 'true';

  if (useMock) {
    // Return mock reply for testing
    res.json({
      replyTemplate: `お世話になっております。\n\nメールをご確認いただきありがとうございます。\nご連絡いただいた件について承知いたしました。\n\n何かご不明な点がございましたら、お気軽にお問い合わせください。\n\nよろしくお願いいたします。`,
      suggestions: [
        '確認して返信する',
        '詳細を問い合わせる',
        'ミーティングを提案する'
      ]
    });
    return;
  }

  if (!apiKey) {
    res.status(500).json({ error: 'AI service not configured' });
    return;
  }

  try {
    const anthropic = new Anthropic({ apiKey });

    // Generate contextual reply using Claude
    const prompt = `Based on this email, generate a professional reply template in Japanese.

Email Subject: ${subject}
From: ${from}
Email Content: ${emailContent.substring(0, 2000)}
${context ? `Additional Context: ${context}` : ''}

Generate a reply that:
1. Is professional and polite
2. Acknowledges the main points
3. Provides placeholders [具体的な内容] where specific details should be added
4. Is culturally appropriate for Japanese business communication

Return ONLY valid JSON with this structure:
{
  "replyTemplate": "The reply template in Japanese",
  "suggestions": ["3-5 suggested actions or points to include"]
}`;

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Parse response
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Invalid response type');
    }

    let jsonStr = content.text;
    jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    const result = JSON.parse(jsonStr);

    // Log for cost tracking
    console.log(`Reply generated for email from ${from} - ~500 tokens used`);

    res.json(result);
  } catch (error) {
    console.error('Reply generation error:', error);
    res.status(500).json({
      error: 'Failed to generate reply',
      fallback: 'お世話になっております。\n\nメールありがとうございます。\n内容を確認させていただきます。'
    });
  }
});

// Get reply statistics
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  // This could be enhanced to track actual usage
  res.json({
    message: 'Reply generation is on-demand only',
    estimatedSavings: 'Significant cost reduction by generating only when needed',
    usage: 'Tracks user-initiated reply generations only'
  });
});

export default router;