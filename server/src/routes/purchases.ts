import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { PurchaseExtractor } from '../services/purchaseExtractor';
import { db } from '../services/database';
import { apiCache, cacheKeys } from '../utils/cache';

const router = Router();
const purchaseExtractor = new PurchaseExtractor();

// Helper function to determine email type
function determineEmailType(subject: string, body: string): 'order' | 'shipping' | 'cancellation' | 'unknown' {
  const subjectLower = subject.toLowerCase();
  const bodyLower = body.toLowerCase();

  // Cancellation indicators (check first for priority)
  const cancellationKeywords = [
    'キャンセル', 'cancelled', 'canceled', 'cancellation',
    '取消', 'refund', '返金', 'order cancelled', 'order canceled',
    'ご注文のキャンセル', 'order has been cancelled', 'order has been canceled',
    'キャンセルされました', 'キャンセル完了'
  ];

  // Shipping indicators
  const shippingKeywords = [
    '発送', 'shipped', 'shipping', 'dispatched', 'delivered',
    '配送', 'tracking', '追跡', '出荷', 'on its way',
    'has been sent', 'お届け'
  ];

  // Order confirmation indicators
  const orderKeywords = [
    '注文', 'order confirmation', 'order placed', 'order received',
    'thank you for your order', 'ご注文', '購入完了', '注文確定',
    'order #', '注文番号', 'purchase confirmation'
  ];

  // Check for cancellation indicators first
  const isCancellation = cancellationKeywords.some(keyword =>
    subjectLower.includes(keyword) || bodyLower.includes(keyword)
  );

  if (isCancellation) {
    return 'cancellation';
  }

  // Check for shipping indicators
  const isShipping = shippingKeywords.some(keyword =>
    subjectLower.includes(keyword) || bodyLower.includes(keyword)
  );

  // Check for order indicators
  const isOrder = orderKeywords.some(keyword =>
    subjectLower.includes(keyword) || bodyLower.includes(keyword)
  );

  // Order priority over shipping
  if (isOrder && !isShipping) {
    return 'order';
  } else if (isShipping) {
    return 'shipping';
  }

  return 'unknown';
}

interface StoredPurchase {
  id: string;
  orderId?: string;
  vendor: string;
  amount: number;
  currency: string;
  date: string;
  items: any[];
  status?: string;
  trackingNumber?: string;
  category?: string;
  paymentMethod?: string;
  emailId: string;
  userId: string;
  emailSubject?: string;
  emailFrom?: string;
  emailType?: 'order' | 'shipping' | 'cancellation' | 'unknown';
  relatedEmailIds?: string[];
}

// Remove in-memory storage - use database instead
// const purchasesDB = new Map<string, StoredPurchase[]>();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const cacheKey = cacheKeys.purchases(userId);

  // Check cache first
  const cachedData = apiCache.get(cacheKey) as any;
  if (cachedData && !req.query.refresh) {
    res.json({
      ...cachedData,
      cached: true,
      cacheAge: Date.now() - (cachedData.timestamp || Date.now())
    });
    return;
  }

  const userPurchases = await db.getPurchases(userId);

  // Get excluded email IDs
  const excludedIds = await db.getExclusions(userId);

  // Mark excluded purchases
  const purchasesWithStatus = userPurchases.map(p => ({
    ...p,
    isExcluded: excludedIds.includes(p.emailId)
  }));

  // Calculate statistics (excluding manually excluded items)
  const activePurchases = purchasesWithStatus.filter(p => !p.isExcluded);
  const totalSpent = activePurchases.reduce((sum, p) => sum + p.amount, 0);
  const categorySummary = activePurchases.reduce((acc, p) => {
    const cat = p.category || 'Other';
    acc[cat] = (acc[cat] || 0) + p.amount;
    return acc;
  }, {} as Record<string, number>);

  const monthlySpending = activePurchases.reduce((acc, p) => {
    const month = new Date(p.date).toISOString().substring(0, 7);
    acc[month] = (acc[month] || 0) + p.amount;
    return acc;
  }, {} as Record<string, number>);

  const responseData = {
    purchases: purchasesWithStatus.sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    ),
    statistics: {
      totalSpent,
      totalPurchases: activePurchases.length,
      categorySummary,
      monthlySpending,
      averagePurchase: activePurchases.length > 0 ? totalSpent / activePurchases.length : 0,
      excludedCount: excludedIds.length
    },
    timestamp: Date.now()
  };

  // Cache for 2 minutes
  apiCache.set(cacheKey, responseData, 2 * 60 * 1000);

  res.json({
    ...responseData,
    cached: false
  });
});

router.post('/extract', requireAuth, async (req: Request, res: Response) => {
  const { emailBody, subject, from, emailId, timestamp, emailSubject, emailFrom } = req.body;
  const userId = (req.user as any).id;

  if (!emailBody || !subject || !from || !emailId) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    const purchase = await purchaseExtractor.extractPurchase(emailBody, subject, from, emailId, timestamp);

    if (!purchase) {
      res.json({ extracted: false, message: 'No purchase information found' });
      return;
    }

    // Get existing purchases from database
    const userPurchases = await db.getPurchases(userId);
    const storedPurchase: StoredPurchase = {
      ...purchase,
      date: purchase.date.toISOString(),
      userId,
      emailSubject: emailSubject || subject,
      emailFrom: emailFrom || from
    };

    // Determine email type
    const emailType = determineEmailType(subject, emailBody);
    storedPurchase.emailType = emailType;

    // If it's a cancellation, automatically exclude it
    if (emailType === 'cancellation') {
      // Find and mark related purchases as excluded
      if (storedPurchase.orderId) {
        const relatedPurchase = userPurchases.find(p =>
          p.orderId === storedPurchase.orderId && p.vendor === storedPurchase.vendor
        );
        if (relatedPurchase) {
          await db.markAsExcluded(relatedPurchase.emailId, userId, 'cancelled');
        }
      }
      // Also mark this cancellation email as excluded
      await db.markAsExcluded(emailId, userId, 'cancellation_email');

      res.json({
        extracted: true,
        purchase: storedPurchase,
        isNew: false,
        isCancellation: true,
        confidence: purchase.confidence,
        aiAnalyzed: purchase.aiAnalyzed
      });
      return;
    }

    // Check if already exists by emailId
    const existingByEmail = userPurchases.findIndex(p => p.emailId === emailId);
    if (existingByEmail !== -1) {
      res.json({
        extracted: true,
        purchase: userPurchases[existingByEmail],
        isNew: false,
        confidence: purchase.confidence,
        aiAnalyzed: purchase.aiAnalyzed
      });
      return;
    }

    // Check for duplicates based on orderId and vendor
    let isDuplicate = false;
    if (storedPurchase.orderId && storedPurchase.vendor) {
      const duplicateIndex = userPurchases.findIndex(p =>
        p.orderId === storedPurchase.orderId &&
        p.vendor === storedPurchase.vendor &&
        Math.abs(p.amount - storedPurchase.amount) < 1 // Allow small differences
      );

      if (duplicateIndex !== -1) {
        const existing = userPurchases[duplicateIndex];

        // If new email is order and existing is shipping, keep order (order priority)
        if (emailType === 'order' && existing.emailType === 'shipping') {
          userPurchases[duplicateIndex] = {
            ...storedPurchase,
            trackingNumber: existing.trackingNumber || storedPurchase.trackingNumber,
            relatedEmailIds: [...(existing.relatedEmailIds || []), existing.emailId],
            emailType: 'order'
          };
          isDuplicate = true;
        }
        // If new email is shipping and existing is order, just add tracking info
        else if (emailType === 'shipping' && existing.emailType === 'order') {
          if (storedPurchase.trackingNumber) {
            userPurchases[duplicateIndex].trackingNumber = storedPurchase.trackingNumber;
          }
          userPurchases[duplicateIndex].relatedEmailIds = [
            ...(existing.relatedEmailIds || []),
            emailId
          ];
          isDuplicate = true;
        }
        // Same type or unknown - check by date and amount
        else if (Math.abs(new Date(existing.date).getTime() - new Date(storedPurchase.date).getTime()) < 7 * 24 * 60 * 60 * 1000) {
          // Within 7 days - likely duplicate
          userPurchases[duplicateIndex].relatedEmailIds = [
            ...(existing.relatedEmailIds || []),
            emailId
          ];
          isDuplicate = true;
        }
      }
    }

    // Check for duplicates based on tracking number
    if (!isDuplicate && storedPurchase.trackingNumber) {
      const trackingDuplicate = userPurchases.findIndex(p =>
        p.trackingNumber === storedPurchase.trackingNumber &&
        p.vendor === storedPurchase.vendor
      );

      if (trackingDuplicate !== -1) {
        userPurchases[trackingDuplicate].relatedEmailIds = [
          ...(userPurchases[trackingDuplicate].relatedEmailIds || []),
          emailId
        ];
        isDuplicate = true;
      }
    }

    if (!isDuplicate) {
      await db.savePurchase(storedPurchase, userId);
    } else {
      // Update the duplicate with new info
      const duplicatePurchase = userPurchases.find(p =>
        (p.orderId && p.orderId === storedPurchase.orderId) ||
        (p.trackingNumber && p.trackingNumber === storedPurchase.trackingNumber)
      );
      if (duplicatePurchase) {
        await db.savePurchase(duplicatePurchase, userId);
      }
    }

    // Clear cache when new purchase is added
    apiCache.delete(cacheKeys.purchases(userId));

    res.json({
      extracted: true,
      purchase: isDuplicate ? userPurchases.find(p =>
        p.orderId === storedPurchase.orderId ||
        p.trackingNumber === storedPurchase.trackingNumber
      ) : storedPurchase,
      isNew: !isDuplicate,
      confidence: purchase.confidence,
      aiAnalyzed: purchase.aiAnalyzed,
      isDuplicate
    });
  } catch (error) {
    console.error('Purchase extraction error:', error);
    res.status(500).json({ error: 'Failed to extract purchase information' });
  }
});

// Clear all purchases (for debugging/reset)
router.delete('/clear', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const purchases = await db.getPurchases(userId);
  for (const purchase of purchases) {
    await db.deletePurchase(purchase.id, userId);
  }
  res.json({ success: true, message: 'All purchases cleared' });
});

router.get('/categories', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const userPurchases = await db.getPurchases(userId);

  const categories = [...new Set(userPurchases.map(p => p.category || 'Other'))];

  res.json({ categories });
});

router.get('/vendors', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const userPurchases = await db.getPurchases(userId);

  const vendors = userPurchases.reduce((acc, p) => {
    if (!acc[p.vendor]) {
      acc[p.vendor] = {
        name: p.vendor,
        totalSpent: 0,
        purchaseCount: 0
      };
    }
    acc[p.vendor].totalSpent += p.amount;
    acc[p.vendor].purchaseCount += 1;
    return acc;
  }, {} as Record<string, any>);

  res.json({
    vendors: Object.values(vendors).sort((a: any, b: any) => b.totalSpent - a.totalSpent)
  });
});

router.delete('/:purchaseId', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { purchaseId } = req.params;

  try {
    await db.deletePurchase(purchaseId, userId);
    res.status(204).send();
  } catch (error) {
    res.status(404).json({ error: 'Purchase not found' });
  }
});

// Mark purchase as excluded (not a real purchase)
router.post('/:purchaseId/exclude', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { purchaseId } = req.params;
  const { reason } = req.body;

  console.log('Exclude request - purchaseId:', purchaseId, 'userId:', userId);

  const userPurchases = await db.getPurchases(userId);
  const purchase = userPurchases.find((p: any) => p.id === purchaseId);

  if (!purchase) {
    console.log('Purchase not found:', purchaseId);
    res.status(404).json({ error: 'Purchase not found' });
    return;
  }

  console.log('Found purchase:', purchase.id, 'email_id:', purchase.email_id, 'emailId:', purchase.emailId);

  const emailIdToExclude = purchase.emailId || purchase.email_id;
  if (!emailIdToExclude) {
    console.error('No email ID found for purchase:', purchase);
    res.status(400).json({ error: 'No email ID found for this purchase' });
    return;
  }

  await db.markAsExcluded(emailIdToExclude, userId, reason || 'manual');
  res.json({ success: true, message: 'Purchase marked as excluded' });
});

// Unmark purchase as excluded
router.delete('/:purchaseId/exclude', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { purchaseId } = req.params;

  console.log('Unexclude request - purchaseId:', purchaseId, 'userId:', userId);

  const userPurchases = await db.getPurchases(userId);
  const purchase = userPurchases.find((p: any) => p.id === purchaseId);

  if (!purchase) {
    console.log('Purchase not found for unexclude:', purchaseId);
    res.status(404).json({ error: 'Purchase not found' });
    return;
  }

  const emailIdToUnexclude = purchase.emailId || purchase.email_id;
  console.log('Unexcluding email_id:', emailIdToUnexclude);

  await db.unmarkAsExcluded(emailIdToUnexclude, userId);
  res.json({ success: true, message: 'Purchase exclusion removed' });
});

export default router;