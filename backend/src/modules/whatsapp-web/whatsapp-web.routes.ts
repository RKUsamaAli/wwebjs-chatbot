import { Router } from 'express';
import * as controller from './whatsapp-web.controller';

const router = Router();

router.post('/connect', controller.connect);
router.post('/disconnect', controller.disconnect);
router.get('/status', controller.getStatus);

export default router;
