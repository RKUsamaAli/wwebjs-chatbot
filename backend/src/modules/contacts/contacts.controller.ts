import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { sendSuccess, sendError } from '../../utils/apiResponse';

export const getContacts = async (req: Request, res: Response) => {
  try {
    const contacts = await prisma.contact.findMany({
      orderBy: { name: 'asc' },
    });
    sendSuccess(res, contacts, 'Contacts retrieved');
  } catch (error: any) {
    sendError(res, error, 'Failed to retrieve contacts');
  }
};

export const createContact = async (req: Request, res: Response) => {
  try {
    const { name, phone, email } = req.body as { name: string; phone: string; email?: string };
    if (!name || !phone) {
      return sendError(res, new Error('Missing "name" or "phone" fields'), 'Invalid Request', 400);
    }
    const cleanPhone = phone.replace(/[+\s-]/g, '');

    const contact = await prisma.contact.upsert({
      where: { phone: cleanPhone },
      update: { name, email },
      create: { name, phone: cleanPhone, email },
    });
    sendSuccess(res, contact, 'Contact saved successfully', 201);
  } catch (error: any) {
    sendError(res, error, 'Failed to save contact');
  }
};
