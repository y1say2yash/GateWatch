import { Router } from 'express';

import { requireAdmin } from '../auth/admin-middleware.js';
import { requireAuthentication } from '../auth/session-middleware.js';
import { listAuditLogsController } from './admin-controller.js';

const router = Router();

router.use(requireAuthentication, requireAdmin);

router.get('/audit-logs', listAuditLogsController);

export default router;
