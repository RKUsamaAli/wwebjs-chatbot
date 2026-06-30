import { Router } from 'express';
import * as controller from './contacts.controller';

const router = Router();

router.get('/', controller.getContacts);
router.post('/', controller.createContact);

export default router;
