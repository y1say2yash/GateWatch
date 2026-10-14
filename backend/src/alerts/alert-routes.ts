import { Router } from 'express';

import { requireAuthentication } from '../auth/session-middleware.js';
import {
    createAlertController,
    deleteAlertController,
    disableAlertController,
    enableAlertController,
    evaluateAlertController,
    getAlertController,
    listApiAlertsController,
    listAlertEventsController,
    transitionAlertController,
    updateAlertController,
} from './alert-controller.js';

const router = Router();

router.use(requireAuthentication);

router.get('/apis/:apiId/alerts', listApiAlertsController);
router.post('/apis/:apiId/alerts', createAlertController);
router.get('/alerts/:alertId', getAlertController);
router.get('/alerts/:alertId/evaluate', evaluateAlertController);
router.post('/alerts/:alertId/evaluate', transitionAlertController);
router.get('/alerts/:alertId/events', listAlertEventsController);
router.patch('/alerts/:alertId', updateAlertController);
router.post('/alerts/:alertId/enable', enableAlertController);
router.post('/alerts/:alertId/disable', disableAlertController);
router.delete('/alerts/:alertId', deleteAlertController);

export default router;
