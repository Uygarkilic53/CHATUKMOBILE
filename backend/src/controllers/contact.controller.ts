import type { Request, Response } from 'express';
import { sendContactEmail } from '../services/email.service.js';
import type { ContactSubmissionPayload } from '../services/email.service.js';

export async function handleContactSubmission(req: Request, res: Response): Promise<void> {
  try {
    const { name, email, category, message, attachments } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({ success: false, message: 'Name must be at least 2 characters.' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
      res.status(400).json({ success: false, message: 'A valid email address is required.' });
      return;
    }

    if (!category || typeof category !== 'string') {
      res.status(400).json({ success: false, message: 'Category is required.' });
      return;
    }

    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      res.status(400).json({ success: false, message: 'Message must be at least 10 characters long.' });
      return;
    }

    const validAttachments: string[] = Array.isArray(attachments)
      ? attachments.filter((url) => typeof url === 'string' && url.trim().length > 0)
      : [];

    const payload: ContactSubmissionPayload = {
      name: name.trim(),
      email: email.trim(),
      category: category.trim(),
      message: message.trim(),
      attachments: validAttachments,
    };

    await sendContactEmail(payload);

    res.status(200).json({
      success: true,
      message: 'Your feedback has been submitted to the dev team. Thank you!',
    });
  } catch (error: any) {
    console.error('Contact submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deliver message to dev team. Please try again later.',
      error: error?.message,
    });
  }
}

