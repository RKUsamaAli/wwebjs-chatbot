import { Router } from 'express';
import multer from 'multer';
import * as controller from './messages.controller';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/text', controller.sendText);
router.post('/media', upload.single('file'), controller.sendMedia);
router.put('/:id/read', controller.markAsRead);
router.delete('/', controller.clearConversation);
router.get('/', controller.getMessages);

export default router;
